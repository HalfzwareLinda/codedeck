/**
 * Voice Mode orchestrator.
 *
 * Wires TTS output, STT input, and voice command parsing into a
 * coherent hands-free loop. Mounted once in MainPanel.
 *
 * Decomposed into focused sub-hooks:
 *   - useVoiceTtsSetup: TTS init, rate sync, speaking state
 *   - useVoiceActionDispatch: command execution + STT result routing
 *   - useVoiceEntryScanner: new-entry detection + session-switch reading
 *   - useVoiceAutoListen: auto-listen after TTS finishes
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { useVoiceModeStore } from '../stores/voiceModeStore';
import { useSessionStore } from '../stores/sessionStore';
import { useSpeechContext, type SpeechContextValue } from '../contexts/SpeechContext';
import { formatForSpeech, formatSessionSwitchSummary } from '../utils/ttsFormatter';
import { parseVoiceCommand, type VoiceContext, type VoiceAction } from '../utils/voiceCommands';
import * as ttsService from '../services/ttsService';
import type { OutputEntry } from '../types';
import type { TtsUtterance } from '../services/ttsService';

/** Returns true when the entry is an interactive prompt requiring user action. */
function isActionable(entry: OutputEntry): boolean {
  const special = entry.metadata?.special as string | undefined;
  return special === 'plan_approval' || special === 'ask_question' || special === 'permission_request';
}

/** Get the voice context for a given entry's special type. */
function entryToVoiceContext(entry: OutputEntry): VoiceContext {
  const special = entry.metadata?.special as string | undefined;
  switch (special) {
    case 'permission_request': return 'permission';
    case 'plan_approval':
      return entry.metadata?.has_plan === false ? 'plan_approval_no_plan' : 'plan_approval';
    case 'ask_question': return 'question';
    default: return 'idle';
  }
}

function speakText(text: string, sessionId: string, cardId: string) {
  ttsService.speak({ id: crypto.randomUUID(), sessionId, cardId, text });
}

/** Shared mutable state passed between sub-hooks. */
interface VoiceRefs {
  enabledRef: React.RefObject<boolean>;
  voiceContextRef: React.RefObject<VoiceContext>;
  currentCardRef: React.RefObject<{ sessionId: string; cardId: string; entry: OutputEntry } | null>;
  queuedCardsRef: React.RefObject<Map<string, { sessionId: string; cardId: string; entry: OutputEntry; voiceContext: VoiceContext }>>;
  dictationBufferRef: React.RefObject<string>;
  lastReadIndexRef: React.RefObject<Map<string, number>>;
  prevActiveSessionRef: React.RefObject<string | null>;
  sessionSwitchTimerRef: React.RefObject<ReturnType<typeof setTimeout> | null>;
}

// ---------------------------------------------------------------------------
// Sub-hook 1: TTS initialization, rate sync, speaking state propagation
// ---------------------------------------------------------------------------

function useVoiceTtsSetup(speechRate: number, isCardResponded: (sid: string, cid: string) => boolean): boolean {
  const [ttsAvailable, setTtsAvailable] = useState(false);

  useEffect(() => {
    ttsService.initTts().then(setTtsAvailable);
  }, []);

  useEffect(() => {
    ttsService.setRate(speechRate);
  }, [speechRate]);

  useEffect(() => {
    ttsService.setRespondedCheck((sid, cid) => isCardResponded(sid, cid));
  }, [isCardResponded]);

  useEffect(() => {
    return ttsService.onStateChange((state) => {
      useVoiceModeStore.setState({ speaking: state.speaking });
    });
  }, []);

  return ttsAvailable;
}

// ---------------------------------------------------------------------------
// Sub-hook 2: Voice action dispatch + STT result routing
// ---------------------------------------------------------------------------

interface DispatchDeps {
  stt: SpeechContextValue;
  refs: VoiceRefs;
  markCardResponded: (sid: string, cid: string) => void;
  respondRemotePermission: (sid: string, cid: string, allow: boolean, modifier?: 'always' | 'never') => void;
  sendRemoteKeypress: (sid: string, key: string, context?: 'plan-approval' | 'exit-plan' | 'question') => void;
  sendMessage: (sid: string, text: string) => void;
  setPendingRevision: (sid: string) => void;
  clearPendingQuestion: (sid: string) => void;
  outputs: Record<string, OutputEntry[]>;
}

function useVoiceActionDispatch(deps: DispatchDeps) {
  const { stt, refs, markCardResponded, respondRemotePermission, sendRemoteKeypress,
    sendMessage, setPendingRevision, clearPendingQuestion, outputs } = deps;

  function resetVoiceState(opts?: { clearDictation?: boolean }) {
    refs.voiceContextRef.current = 'idle';
    refs.currentCardRef.current = null;
    stt.setVoiceHandler(null);
    if (opts?.clearDictation) refs.dictationBufferRef.current = '';
  }

  const executeAction = useCallback((action: VoiceAction) => {
    const card = refs.currentCardRef.current;
    if (!card && action.type !== 'stop' && action.type !== 'skip') return;

    const sessionId = card?.sessionId ?? '';
    const cardId = card?.cardId ?? '';

    switch (action.type) {
      case 'keypress': {
        if (!sessionId) break;
        const special = card?.entry.metadata?.special as string | undefined;
        markCardResponded(sessionId, cardId);

        if (special === 'permission_request') {
          const allow = action.key !== '3';
          const modifier = action.key === '2' ? 'always' as const : action.key === '3' ? 'never' as const : undefined;
          respondRemotePermission(sessionId, cardId, allow, modifier);
        } else if (special === 'plan_approval') {
          const context = card?.entry.metadata?.has_plan === false ? 'exit-plan' as const : 'plan-approval' as const;
          sendRemoteKeypress(sessionId, action.key, context);
        } else if (special === 'ask_question') {
          clearPendingQuestion(sessionId);
          sendRemoteKeypress(sessionId, action.key, 'question');
        }

        resetVoiceState();
        speakText(`${action.label}.`, sessionId, `confirm-${cardId}`);
        break;
      }

      case 'dictation_start': {
        if (sessionId) {
          const special = card?.entry.metadata?.special as string | undefined;
          if (special === 'plan_approval') {
            markCardResponded(sessionId, cardId);
            sendRemoteKeypress(sessionId, '3', 'plan-approval');
            setPendingRevision(sessionId);
          }
        }
        refs.dictationBufferRef.current = '';
        refs.voiceContextRef.current = 'dictating';
        speakText('Dictate your revision. Say send when done.', sessionId, `dictate-${cardId}`);
        break;
      }

      case 'dictation_submit': {
        const text = action.text || refs.dictationBufferRef.current;
        const targetSession = sessionId && sessionId === useSessionStore.getState().activeSessionId
          ? sessionId : useSessionStore.getState().activeSessionId;
        if (text && targetSession) {
          sendMessage(targetSession, text);
        }
        resetVoiceState({ clearDictation: true });
        speakText('Sent.', sessionId, `sent-${cardId}`);
        break;
      }

      case 'dictation_cancel': {
        resetVoiceState({ clearDictation: true });
        speakText('Cancelled.', sessionId, `cancel-${cardId}`);
        break;
      }

      case 'read_back': {
        const buf = refs.dictationBufferRef.current;
        speakText(buf || 'Nothing dictated yet.', sessionId, `readback-${Date.now()}`);
        break;
      }

      case 'read_plan': {
        if (sessionId) {
          const entries = outputs[sessionId] ?? [];
          const planEntry = [...entries].reverse().find(
            (e) => (e.metadata?.special as string) === 'plan' && e.content,
          );
          speakText(
            planEntry ? planEntry.content.slice(0, 500) : 'No plan content found.',
            sessionId,
            `plan-${Date.now()}`,
          );
        }
        break;
      }

      case 'skip':
        ttsService.cancelAll();
        refs.queuedCardsRef.current.clear();
        refs.voiceContextRef.current = 'idle';
        break;

      case 'stop':
        ttsService.cancelAll();
        refs.queuedCardsRef.current.clear();
        resetVoiceState();
        break;

      case 'repeat': {
        if (card) {
          const text = formatForSpeech(card.entry);
          if (text) speakText(text, card.sessionId, `repeat-${card.cardId}`);
        }
        break;
      }

      case 'unrecognized': {
        if (refs.voiceContextRef.current === 'dictating') break;
        speakText("Didn't catch that. Please repeat.", sessionId, `retry-${Date.now()}`);
        break;
      }
    }
  }, [markCardResponded, respondRemotePermission, sendRemoteKeypress,
      sendMessage, setPendingRevision, clearPendingQuestion, outputs, stt]);

  const handleVoiceResult = useCallback((transcript: string) => {
    const context = refs.voiceContextRef.current;

    if (context === 'dictating') {
      const action = parseVoiceCommand(transcript, 'dictating');
      if (action.type === 'dictation_submit') {
        const fullText = refs.dictationBufferRef.current
          ? `${refs.dictationBufferRef.current} ${action.text}`
          : action.text;
        executeAction({ type: 'dictation_submit', text: fullText });
      } else if (action.type === 'dictation_cancel' || action.type === 'read_back') {
        executeAction(action);
      } else {
        const sep = refs.dictationBufferRef.current ? ' ' : '';
        refs.dictationBufferRef.current += sep + transcript;
      }
      return;
    }

    const action = parseVoiceCommand(transcript, context);
    executeAction(action);
  }, [executeAction]);

  return { executeAction, handleVoiceResult, resetVoiceState };
}

// ---------------------------------------------------------------------------
// Sub-hook 3: Scan new actionable entries + auto-read on session switch
// ---------------------------------------------------------------------------

interface ScannerDeps {
  enabled: boolean;
  ttsAvailable: boolean;
  refs: VoiceRefs;
  resetVoiceState: (opts?: { clearDictation?: boolean }) => void;
}

function useVoiceEntryScanner(deps: ScannerDeps) {
  const { enabled, ttsAvailable, refs, resetVoiceState } = deps;

  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const outputs = useSessionStore((s) => s.outputs);
  const historyLoading = useSessionStore((s) => s.historyLoading);
  const isCardResponded = useSessionStore((s) => s.isCardResponded);

  const getUnrespondedActionable = useCallback((sessionId: string): OutputEntry[] => {
    const entries = outputs[sessionId] ?? [];
    return entries.filter((e) => {
      if (!isActionable(e)) return false;
      const cardId = (e.metadata?.tool_use_id as string) ?? '';
      return cardId && !isCardResponded(sessionId, cardId);
    });
  }, [outputs, isCardResponded]);

  // Speak new actionable entries in the active session
  useEffect(() => {
    if (!enabled || !ttsAvailable || !activeSessionId) return;
    if (historyLoading[activeSessionId]) return;

    const entries = outputs[activeSessionId] ?? [];
    const lastRead = refs.lastReadIndexRef.current.get(activeSessionId) ?? -1;

    for (let i = Math.max(0, lastRead + 1); i < entries.length; i++) {
      const entry = entries[i];
      if (!isActionable(entry)) continue;

      const cardId = (entry.metadata?.tool_use_id as string) ?? '';
      if (!cardId || isCardResponded(activeSessionId, cardId)) continue;

      const text = formatForSpeech(entry);
      if (!text) continue;

      const vc = entryToVoiceContext(entry);
      refs.queuedCardsRef.current.set(cardId, { sessionId: activeSessionId, cardId, entry, voiceContext: vc });
      speakText(text, activeSessionId, cardId);
    }

    if (entries.length > 0) {
      refs.lastReadIndexRef.current.set(activeSessionId, entries.length - 1);
    }
  }, [enabled, ttsAvailable, activeSessionId, outputs, historyLoading, isCardResponded]);

  // Auto-read on session switch
  useEffect(() => {
    if (!enabled || !ttsAvailable) return;

    const prev = refs.prevActiveSessionRef.current;
    refs.prevActiveSessionRef.current = activeSessionId;

    if (!activeSessionId || activeSessionId === prev) return;

    if (refs.sessionSwitchTimerRef.current) clearTimeout(refs.sessionSwitchTimerRef.current);

    refs.sessionSwitchTimerRef.current = setTimeout(() => {
      ttsService.cancelAll();
      refs.queuedCardsRef.current.clear();

      if (refs.voiceContextRef.current !== 'idle') {
        resetVoiceState({ clearDictation: true });
      }

      const pending = getUnrespondedActionable(activeSessionId);
      if (pending.length === 0) return;

      const latest = pending[pending.length - 1];
      const summary = formatSessionSwitchSummary(pending.length, latest);
      if (!summary) return;

      const cardId = (latest.metadata?.tool_use_id as string) ?? '';
      const switchCardId = `switch-${cardId}`;
      const vc = entryToVoiceContext(latest);
      refs.queuedCardsRef.current.set(switchCardId, { sessionId: activeSessionId, cardId, entry: latest, voiceContext: vc });
      speakText(summary, activeSessionId, switchCardId);

      const entries = outputs[activeSessionId] ?? [];
      refs.lastReadIndexRef.current.set(activeSessionId, entries.length - 1);
    }, 300);

    return () => {
      if (refs.sessionSwitchTimerRef.current) clearTimeout(refs.sessionSwitchTimerRef.current);
    };
  }, [enabled, ttsAvailable, activeSessionId, getUnrespondedActionable, outputs]);
}

// ---------------------------------------------------------------------------
// Sub-hook 4: Auto-listen after TTS finishes speaking
// ---------------------------------------------------------------------------

function useVoiceAutoListen(
  enabled: boolean,
  autoListen: boolean,
  stt: SpeechContextValue,
  handleVoiceResult: (transcript: string) => void,
  refs: VoiceRefs,
) {
  useEffect(() => {
    if (!enabled || !autoListen) return;

    const unsub = ttsService.onUtteranceEnd(() => {
      if (refs.voiceContextRef.current === 'idle' && !refs.currentCardRef.current) return;

      setTimeout(() => {
        if (!refs.enabledRef.current) return;
        stt.setVoiceHandler(handleVoiceResult);
        stt.startListening().catch((e) => console.warn('[VoiceMode] STT start failed:', e));
      }, 500);
    });

    return unsub;
  }, [enabled, autoListen, stt, handleVoiceResult]);
}

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

export function useVoiceMode() {
  const enabled = useVoiceModeStore((s) => s.enabled);
  const autoListen = useVoiceModeStore((s) => s.autoListenAfterRead);
  const speechRate = useVoiceModeStore((s) => s.speechRate);

  const outputs = useSessionStore((s) => s.outputs);
  const isCardResponded = useSessionStore((s) => s.isCardResponded);
  const markCardResponded = useSessionStore((s) => s.markCardResponded);
  const sendRemoteKeypress = useSessionStore((s) => s.sendRemoteKeypress);
  const respondRemotePermission = useSessionStore((s) => s.respondRemotePermission);
  const sendMessage = useSessionStore((s) => s.sendMessage);
  const setPendingRevision = useSessionStore((s) => s.setPendingRevision);
  const clearPendingQuestion = useSessionStore((s) => s.clearPendingQuestion);

  const stt = useSpeechContext();

  // Shared mutable state
  const refs: VoiceRefs = {
    enabledRef: useRef(enabled),
    voiceContextRef: useRef<VoiceContext>('idle'),
    currentCardRef: useRef<{ sessionId: string; cardId: string; entry: OutputEntry } | null>(null),
    queuedCardsRef: useRef(new Map()),
    dictationBufferRef: useRef(''),
    lastReadIndexRef: useRef(new Map()),
    prevActiveSessionRef: useRef<string | null>(null),
    sessionSwitchTimerRef: useRef<ReturnType<typeof setTimeout> | null>(null),
  };
  refs.enabledRef.current = enabled;

  // Sub-hook 1: TTS setup
  const ttsAvailable = useVoiceTtsSetup(speechRate, isCardResponded);

  // Sub-hook 2: Action dispatch
  const { handleVoiceResult, resetVoiceState } = useVoiceActionDispatch({
    stt, refs, markCardResponded, respondRemotePermission, sendRemoteKeypress,
    sendMessage, setPendingRevision, clearPendingQuestion, outputs,
  });

  // Sub-hook 3: Entry scanning + session switch
  useVoiceEntryScanner({ enabled, ttsAvailable, refs, resetVoiceState });

  // Sub-hook 4: Auto-listen
  useVoiceAutoListen(enabled, autoListen, stt, handleVoiceResult, refs);

  // Sync voiceContextRef/currentCardRef when TTS starts playing a queued card
  useEffect(() => {
    return ttsService.onUtteranceStart((utterance: TtsUtterance) => {
      const queued = refs.queuedCardsRef.current.get(utterance.cardId);
      if (queued) {
        refs.voiceContextRef.current = queued.voiceContext;
        refs.currentCardRef.current = { sessionId: queued.sessionId, cardId: queued.cardId, entry: queued.entry };
        refs.queuedCardsRef.current.delete(utterance.cardId);
      }
    });
  }, []);

  // Cleanup on disable
  useEffect(() => {
    if (!enabled) {
      ttsService.cancelAll();
      refs.queuedCardsRef.current.clear();
      resetVoiceState({ clearDictation: true });
    }
  }, [enabled, stt]);
}
