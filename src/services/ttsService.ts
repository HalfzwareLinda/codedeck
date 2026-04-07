/**
 * TTS service abstraction.
 *
 * Uses tauri-plugin-tts on native (Android/desktop) and falls back to
 * Web Speech API in browser dev mode.
 */

import { isTauri } from '../ipc/tauri';

export interface TtsUtterance {
  id: string;
  sessionId: string;
  cardId: string;
  text: string;
}

interface TtsState {
  speaking: boolean;
  queueLength: number;
  currentId: string | null;
}

type StateListener = (state: TtsState) => void;
type EndListener = (utteranceId: string) => void;

// --- Module state ---

let initialized = false;
let available = false;
let rate = 1.0;
let pluginSafetyTimer: ReturnType<typeof setTimeout> | null = null;

/** Safety timeout: if the plugin doesn't fire speech:finish/cancel within
 *  this many ms, force-clear currentUtterance so the queue doesn't stall. */
const PLUGIN_SAFETY_TIMEOUT_MS = 30_000;

const queue: TtsUtterance[] = [];
let currentUtterance: TtsUtterance | null = null;
let isCardRespondedCheck: ((sessionId: string, cardId: string) => boolean) | null = null;

const stateListeners = new Set<StateListener>();
const endListeners = new Set<EndListener>();

// Tauri plugin imports (lazy-loaded)
let pluginSpeak: ((opts: Record<string, unknown>) => Promise<void>) | null = null;
let pluginStop: (() => Promise<void>) | null = null;
let pluginUnlistenFinish: (() => void) | null = null;
let pluginUnlistenCancel: (() => void) | null = null;

function getState(): TtsState {
  return {
    speaking: currentUtterance !== null,
    queueLength: queue.length,
    currentId: currentUtterance?.id ?? null,
  };
}

function notifyState() {
  const s = getState();
  stateListeners.forEach((cb) => cb(s));
}

function notifyEnd(id: string) {
  endListeners.forEach((cb) => cb(id));
}

// --- Browser fallback (Web Speech API, for dev mode) ---

let browserSynth: SpeechSynthesis | null = null;

function browserSpeak(text: string): Promise<void> {
  return new Promise((resolve) => {
    if (!browserSynth) { resolve(); return; }
    const u = new SpeechSynthesisUtterance(text);
    u.rate = rate;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    browserSynth.speak(u);
  });
}

function browserStop() {
  browserSynth?.cancel();
}

// --- Core queue logic ---

async function processNext() {
  if (currentUtterance) return; // already speaking

  while (queue.length > 0) {
    const next = queue.shift()!;

    // Skip if card already responded
    if (isCardRespondedCheck && isCardRespondedCheck(next.sessionId, next.cardId)) {
      continue;
    }

    // Defer if app is hidden — don't pop items, just wait
    if (document.hidden) {
      queue.unshift(next); // put it back
      return; // resume when visibility changes
    }

    currentUtterance = next;
    notifyState();

    try {
      if (pluginSpeak) {
        // Start safety timer — if plugin never fires finish/cancel, unstick the queue
        if (pluginSafetyTimer) clearTimeout(pluginSafetyTimer);
        pluginSafetyTimer = setTimeout(() => {
          if (currentUtterance) {
            console.warn('[TTS] Safety timeout: plugin did not fire finish/cancel, force-clearing');
            onPluginSpeechDone();
          }
        }, PLUGIN_SAFETY_TIMEOUT_MS);

        await pluginSpeak({ text: next.text, rate, queueMode: 'flush' });
        // Completion is handled by the event listener, not the promise
        return;
      } else {
        await browserSpeak(next.text);
      }
    } catch (e) {
      console.warn('[TTS] speak error:', e);
    }

    // Browser path: speech finished inline
    if (!pluginSpeak) {
      const finishedId = currentUtterance.id;
      currentUtterance = null;
      notifyState();
      notifyEnd(finishedId);
    }
  }

  // Queue empty
  if (!currentUtterance) notifyState();
}

function onPluginSpeechDone() {
  if (pluginSafetyTimer) { clearTimeout(pluginSafetyTimer); pluginSafetyTimer = null; }
  if (!currentUtterance) return;
  const finishedId = currentUtterance.id;
  currentUtterance = null;
  notifyState();
  notifyEnd(finishedId);
  // Process next after small delay (Android audio system needs a beat)
  setTimeout(processNext, 100);
}

// Resume queue processing when app returns to foreground
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && queue.length > 0 && !currentUtterance) {
    processNext();
  }
});

// --- Public API ---

export async function initTts(): Promise<boolean> {
  if (initialized) return available;
  initialized = true;

  if (isTauri()) {
    try {
      const mod = await import('tauri-plugin-tts-api');
      pluginSpeak = (opts) => mod.speak(opts as Parameters<typeof mod.speak>[0]);
      pluginStop = () => mod.stop();

      // Register speech event listeners
      pluginUnlistenFinish = await mod.onSpeechEvent('speech:finish', onPluginSpeechDone);
      pluginUnlistenCancel = await mod.onSpeechEvent('speech:cancel', onPluginSpeechDone);

      // Wait for initialization (mobile TTS is async)
      const status = await mod.isInitialized();
      available = status.initialized;

      if (!available) {
        // Poll for up to 3 seconds
        for (let i = 0; i < 6; i++) {
          await new Promise((r) => setTimeout(r, 500));
          const retry = await mod.isInitialized();
          if (retry.initialized) { available = true; break; }
        }
      }

      console.log('[TTS] Plugin initialized, available:', available);
    } catch (e) {
      console.warn('[TTS] Plugin init failed:', e);
      available = false;
    }
  } else {
    // Browser fallback
    browserSynth = window.speechSynthesis ?? null;
    available = browserSynth !== null;
    console.log('[TTS] Browser fallback, available:', available);
  }

  return available;
}

export function isAvailable(): boolean {
  return available;
}

export function speak(utterance: TtsUtterance): void {
  if (!available) return;
  queue.push(utterance);
  notifyState();
  processNext();
}

export function cancelAll(): void {
  queue.length = 0;
  if (currentUtterance) {
    const id = currentUtterance.id;
    currentUtterance = null;
    if (pluginStop) pluginStop().catch(() => {});
    else browserStop();
    notifyState();
    notifyEnd(id);
  }
}

export function cancelForSession(sessionId: string): void {
  // Remove queued items for this session
  for (let i = queue.length - 1; i >= 0; i--) {
    if (queue[i].sessionId === sessionId) queue.splice(i, 1);
  }
  // Cancel current if it belongs to this session
  if (currentUtterance?.sessionId === sessionId) {
    const id = currentUtterance.id;
    currentUtterance = null;
    if (pluginStop) pluginStop().catch(() => {});
    else browserStop();
    notifyEnd(id);
  }
  notifyState();
}

export function setRate(r: number): void {
  rate = Math.max(0.8, Math.min(1.5, r));
}

export function isSpeaking(): boolean {
  return currentUtterance !== null;
}

export function setRespondedCheck(fn: (sessionId: string, cardId: string) => boolean): void {
  isCardRespondedCheck = fn;
}

export function onStateChange(cb: StateListener): () => void {
  stateListeners.add(cb);
  return () => stateListeners.delete(cb);
}

export function onUtteranceEnd(cb: EndListener): () => void {
  endListeners.add(cb);
  return () => endListeners.delete(cb);
}

export function cleanup(): void {
  cancelAll();
  pluginUnlistenFinish?.();
  pluginUnlistenCancel?.();
  stateListeners.clear();
  endListeners.clear();
}
