import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useDmStore } from '../stores/dmStore';
import { useUIStore } from '../stores/uiStore';
import { getPubkeyHex } from '../services/nostrService';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { useMediaQuery } from '../hooks/useMediaQuery';
import type { DmMessage } from '../types';
import '../styles/dm.css';
import '../styles/header.css';

const EMPTY_MESSAGES: DmMessage[] = [];

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

export default function DmConversationView({ conversationId, isWide }: { conversationId: string; isWide: boolean }) {
  const conversation = useDmStore((s) => s.conversations.find(c => c.id === conversationId));
  const messages = useDmStore((s) => s.messages[conversationId] ?? EMPTY_MESSAGES);
  const sendDm = useDmStore((s) => s.sendDm);
  const nostrConfig = useDmStore((s) => s.nostrConfig);
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen);
  const setSettingsOpen = useUIStore((s) => s.setSettingsOpen);

  const [text, setText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isTouchDevice = useMediaQuery('(pointer: coarse)');

  const handleDictationResult = useCallback((transcript: string) => {
    setText(prev => {
      const separator = prev.length > 0 && !prev.endsWith(' ') ? ' ' : '';
      return prev + separator + transcript;
    });
  }, []);

  const {
    available: sttAvailable,
    isListening,
    interimTranscript,
    startListening,
    stopListening,
  } = useSpeechRecognition(handleDictationResult);

  const displayValue = interimTranscript
    ? text + (text && !text.endsWith(' ') ? ' ' : '') + interimTranscript
    : text;

  const ownPubkey = useMemo(() => {
    if (nostrConfig.private_key_hex) {
      try {
        return getPubkeyHex(hexToBytes(nostrConfig.private_key_hex));
      } catch { /* fallback */ }
    }
    return '0'.repeat(64);
  }, [nostrConfig.private_key_hex]);

  const isSent = (msg: { sender_pubkey: string }) => msg.sender_pubkey === ownPubkey;

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'instant' });
  }, [messages.length]);

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed || !conversation) return;

    const recipientPubkey = conversation.participants.find(p => p !== ownPubkey);
    if (!recipientPubkey) return;

    sendDm(recipientPubkey, trimmed);
    setText('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !isTouchDevice) {
      e.preventDefault();
      handleSend();
    }
  };

  const toggleDictation = async () => {
    if (isListening) {
      await stopListening();
    } else {
      textareaRef.current?.blur();
      await startListening();
    }
  };

  if (!conversation) {
    return (
      <div className="dm-view">
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' }}>
          Conversation not found
        </div>
      </div>
    );
  }

  return (
    <div className="dm-view">
      <div className="session-header">
        {!isWide && (
          <button className="header-btn header-hamburger" onClick={() => setSidebarOpen(true)}>
            &#9776;
          </button>
        )}
        <button className="header-btn header-settings" onClick={() => setSettingsOpen(true)}>
          &#9881;
        </button>
        <div className="header-info">
          <div className="header-title">{conversation.display_name}</div>
        </div>
      </div>

      <div className="dm-messages">
        {messages.map((msg) => {
          const recipientPubkey = conversation.participants.find(p => p !== ownPubkey);
          const handleRetry = () => {
            if (msg.status === 'failed' && recipientPubkey) {
              sendDm(recipientPubkey, msg.content);
            }
          };
          return (
            <div key={msg.id} className={`dm-bubble-wrapper ${isSent(msg) ? 'sent' : 'received'}`}>
              <div
                className={`dm-bubble ${isSent(msg) ? 'sent' : 'received'}${msg.status === 'failed' ? ' failed' : ''}`}
              >
                <div className="dm-bubble-content">{msg.content}</div>
                <div className="dm-bubble-time">
                  {formatTime(msg.timestamp)}
                  {msg.status === 'failed' && <span className="dm-send-failed"> — send failed</span>}
                </div>
              </div>
              {msg.status === 'failed' && (
                <button className="dm-retry-btn" onClick={handleRetry} type="button">
                  Retry
                </button>
              )}
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      <div className="dm-input-bar">
        <textarea
          ref={textareaRef}
          className="dm-input-field"
          value={isListening ? displayValue : text}
          onChange={(e) => { if (!isListening) setText(e.target.value); }}
          onKeyDown={handleKeyDown}
          placeholder={isListening ? 'Listening...' : 'Message...'}
          rows={1}
          readOnly={isListening}
        />
        {sttAvailable && (
          <button
            className={`mic-btn ${isListening ? 'mic-active' : ''}`}
            onClick={toggleDictation}
            aria-label={isListening ? 'Stop dictation' : 'Start dictation'}
            type="button"
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
              <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
              <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
            </svg>
          </button>
        )}
        <button
          className="dm-send-btn"
          onClick={handleSend}
          disabled={!text.trim()}
        >
          Send
        </button>
      </div>
    </div>
  );
}
