/**
 * Voice Mode orchestrator.
 *
 * Wires TTS output, STT input, and voice command parsing into a
 * coherent hands-free loop. Mounted once in MainPanel.
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { useVoiceModeStore } from '../stores/voiceModeStore';
import { useSessionStore } from '../stores/sessionStore';
import { useSpeechContext } from '../contexts/SpeechContext';
import { formatForSpeech, formatSessionSwitchSummary } from '../utils/ttsFormatter';
import { parseVoiceCommand, type VoiceContext, type VoiceAction } from '../utils/voiceCommands';
import * as ttsService from '../services/ttsService';
import type { OutputEntry } from '../types';

let idCounter = 0;

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
  ttsService.speak({ id: `tts-${++idCounter}`, sessionId, cardId, text });
}

export function useVoiceMode() {
  const enabled = useVoiceModeStore((s) => s.enabled);
  const autoListen = useVoiceModeStore((s) => s.autoListenAfterRead);
  const speechRate = useVoiceModeStore((s) => s.speechRate);

  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const outputs = useSessionStore((s) => s.outputs);
  const historyLoading = useSessionStore((s) => s.historyLoading);
  const isCardResponded = useSessionStore((s) => s.isCardResponded);
  const markCardResponded = useSessionStore((s) => s.markCardResponded);
  const sendRemoteKeypress = useSessionStore((s) => s.sendRemoteKeypress);
  const respondRemotePermission = useSessionStore((s) => s.respondRemotePermission);
  const sendMessage = useSessionStore((s) => s.sendMessage);
  const setPendingRevision = useSessionStore((s) => s.setPendingRevision);
  const clearPendingQuestion = useSessionStore((s) => s.clearPendingQuestion);

  const stt = useSpeechContext();

  // Track TTS availability + speaking state for SessionHeader
  const [ttsAvailable, setTtsAvailable] = useState(false);

  // Refs for mutable state that shouldn't trigger re-renders
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const voiceContextRef = useRef<VoiceContext>('idle');
  const currentCardRef = useRef<{ sessionId: string; cardId: string; entry: OutputEntry } | null>(null);
  const lastReadIndexRef = useRef<Map<string, number>>(new Map());
  const dictationBufferRef = useRef('');
  const prevActiveSessionRef = useRef<string | null>(null);
  const sessionSwitchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- Init TTS + keep rate in sync ---
  useEffect(() => {
    ttsService.initTts().then(setTtsAvailable);
  }, []);

  useEffect(() => {
    ttsService.setRate(speechRate);
  }, [speechRate]);

  // Register the responded-check callback
  useEffect(() => {
    ttsService.setRespondedCheck((sid, cid) => isCardResponded(sid, cid));
  }, [isCardResponded]);

  // Update voiceModeStore.speaking for SessionHeader UI
  useEffect(() => {
    return ttsService.onStateChange((state) => {
      useVoiceModeStore.setState({ speaking: state.speaking });
    });
  }, []);

  // --- Get unresponded actionable entries for a session ---
  const getUnrespondedActionable = useCallback((sessionId: string): OutputEntry[] => {
    const entries = outputs[sessionId] ?? [];
    return entries.filter((e) => {
      if (!isActionable(e)) return false;
      const cardId = (e.metadata?.tool_use_id as string) ?? '';
      return cardId && !isCardResponded(sessionId, cardId);
    });
  }, [outputs, isCardResponded]);

  // --- Execute a voice action ---
  const executeAction = useCallback((action: VoiceAction) => {
    const card = currentCardRef.current;
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

        voiceContextRef.current = 'idle';
        currentCardRef.current = null;
        stt.setVoiceHandler(null); // Release STT back to InputBar
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
        dictationBufferRef.current = '';
        voiceContextRef.current = 'dictating';
        speakText('Dictate your revision. Say send when done.', sessionId, `dictate-${cardId}`);
        break;
      }

      case 'dictation_submit': {
        const text = action.text || dictationBufferRef.current;
        // Use the card's session, but validate it's still the active session
        const targetSession = sessionId && sessionId === useSessionStore.getState().activeSessionId
          ? sessionId : useSessionStore.getState().activeSessionId;
        if (text && targetSession) {
          sendMessage(targetSession, text);
        }
        dictationBufferRef.current = '';
        voiceContextRef.current = 'idle';
        currentCardRef.current = null;
        stt.setVoiceHandler(null);
        speakText('Sent.', sessionId, `sent-${cardId}`);
        break;
      }

      case 'dictation_cancel': {
        dictationBufferRef.current = '';
        voiceContextRef.current = 'idle';
        currentCardRef.current = null;
        stt.setVoiceHandler(null);
        speakText('Cancelled.', sessionId, `cancel-${cardId}`);
        break;
      }

      case 'read_back': {
        const buf = dictationBufferRef.current;
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
        voiceContextRef.current = 'idle';
        break;

      case 'stop':
        ttsService.cancelAll();
        voiceContextRef.current = 'idle';
        currentCardRef.current = null;
        stt.setVoiceHandler(null);
        break;

      case 'repeat': {
        if (card) {
          const text = formatForSpeech(card.entry);
          if (text) speakText(text, card.sessionId, `repeat-${card.cardId}`);
        }
        break;
      }

      case 'unrecognized': {
        if (voiceContextRef.current === 'dictating') break; // accumulated by STT handler
        speakText("Didn't catch that. Please repeat.", sessionId, `retry-${Date.now()}`);
        break;
      }
    }
  }, [markCardResponded, respondRemotePermission, sendRemoteKeypress,
      sendMessage, setPendingRevision, clearPendingQuestion, outputs, stt]);

  // --- STT result handler for voice commands ---
  const handleVoiceResult = useCallback((transcript: string) => {
    const context = voiceContextRef.current;

    if (context === 'dictating') {
      const action = parseVoiceCommand(transcript, 'dictating');
      if (action.type === 'dictation_submit') {
        const fullText = dictationBufferRef.current
          ? `${dictationBufferRef.current} ${action.text}`
          : action.text;
        executeAction({ type: 'dictation_submit', text: fullText });
      } else if (action.type === 'dictation_cancel' || action.type === 'read_back') {
        executeAction(action);
      } else {
        const sep = dictationBufferRef.current ? ' ' : '';
        dictationBufferRef.current += sep + transcript;
      }
      return;
    }

    const action = parseVoiceCommand(transcript, context);
    executeAction(action);
  }, [executeAction]);

  // --- Auto-listen after TTS finishes ---
  useEffect(() => {
    if (!enabled || !autoListen) return;

    const unsub = ttsService.onUtteranceEnd(() => {
      // Don't auto-listen for confirmation/system utterances
      if (voiceContextRef.current === 'idle' && !currentCardRef.current) return;

      // 500ms gap to avoid STT picking up TTS audio on Android
      setTimeout(() => {
        // Check ref (not stale closure) to handle disable during timeout
        if (!enabledRef.current) return;
        stt.setVoiceHandler(handleVoiceResult);
        stt.startListening().catch((e) => console.warn('[VoiceMode] STT start failed:', e));
      }, 500);
    });

    return unsub;
  }, [enabled, autoListen, stt, handleVoiceResult]);

  // --- Speak new actionable entries in the active session ---
  useEffect(() => {
    if (!enabled || !ttsAvailable || !activeSessionId) return;
    if (historyLoading[activeSessionId]) return;

    const entries = outputs[activeSessionId] ?? [];
    const lastRead = lastReadIndexRef.current.get(activeSessionId) ?? -1;

    for (let i = Math.max(0, lastRead + 1); i < entries.length; i++) {
      const entry = entries[i];
      if (!isActionable(entry)) continue;

      const cardId = (entry.metadata?.tool_use_id as string) ?? '';
      if (!cardId || isCardResponded(activeSessionId, cardId)) continue;

      const text = formatForSpeech(entry);
      if (!text) continue;

      voiceContextRef.current = entryToVoiceContext(entry);
      currentCardRef.current = { sessionId: activeSessionId, cardId, entry };
      speakText(text, activeSessionId, cardId);
    }

    if (entries.length > 0) {
      lastReadIndexRef.current.set(activeSessionId, entries.length - 1);
    }
  }, [enabled, ttsAvailable, activeSessionId, outputs, historyLoading, isCardResponded]);

  // --- Auto-read on session switch ---
  useEffect(() => {
    if (!enabled || !ttsAvailable) return;

    const prev = prevActiveSessionRef.current;
    prevActiveSessionRef.current = activeSessionId;

    if (!activeSessionId || activeSessionId === prev) return;

    if (sessionSwitchTimerRef.current) clearTimeout(sessionSwitchTimerRef.current);

    sessionSwitchTimerRef.current = setTimeout(() => {
      ttsService.cancelAll();

      // Clear any in-progress dictation/voice state from the previous session
      if (voiceContextRef.current !== 'idle') {
        voiceContextRef.current = 'idle';
        dictationBufferRef.current = '';
        currentCardRef.current = null;
        stt.setVoiceHandler(null);
      }

      const pending = getUnrespondedActionable(activeSessionId);
      if (pending.length === 0) return;

      const latest = pending[pending.length - 1];
      const summary = formatSessionSwitchSummary(pending.length, latest);
      if (!summary) return;

      const cardId = (latest.metadata?.tool_use_id as string) ?? '';
      voiceContextRef.current = entryToVoiceContext(latest);
      currentCardRef.current = { sessionId: activeSessionId, cardId, entry: latest };
      speakText(summary, activeSessionId, `switch-${cardId}`);

      const entries = outputs[activeSessionId] ?? [];
      lastReadIndexRef.current.set(activeSessionId, entries.length - 1);
    }, 300);

    return () => {
      if (sessionSwitchTimerRef.current) clearTimeout(sessionSwitchTimerRef.current);
    };
  }, [enabled, ttsAvailable, activeSessionId, getUnrespondedActionable, outputs]);

  // --- Cleanup on disable ---
  useEffect(() => {
    if (!enabled) {
      ttsService.cancelAll();
      voiceContextRef.current = 'idle';
      currentCardRef.current = null;
      dictationBufferRef.current = '';
      stt.setVoiceHandler(null);
    }
  }, [enabled, stt]);

  // --- Load persisted settings on mount ---
  useEffect(() => {
    useVoiceModeStore.getState().loadPersisted();
  }, []);
}
