import { useState, useRef, useEffect, useCallback } from 'react';
import { AgentMode } from '../types';
import { useSessionStore } from '../stores/sessionStore';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { processImageFile } from '../utils/imageUtils';
import '../styles/input.css';

interface PendingImage {
  base64: string;
  filename: string;
  mimeType: string;
  previewUrl: string;   // blob: URL (lightweight, not a base64 copy)
  sizeBytes: number;
}

export default function InputBar({ sessionId, mode }: { sessionId: string; mode?: AgentMode }) {
  const [text, setText] = useState('');
  const [pendingImage, setPendingImage] = useState<PendingImage | null>(null);
  const [sending, setSending] = useState(false);
  const [sendPop, setSendPop] = useState(false);
  const sendMessage = useSessionStore((s) => s.sendMessage);
  const setMode = useSessionStore((s) => s.setMode);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Check if the remote session has no terminal (bridge reported hasTerminal=false).
  // The selector returns a primitive boolean, so zustand skips re-renders when the value is stable.
  const noTerminal = useSessionStore((s) => {
    for (const sessions of Object.values(s.remoteSessions)) {
      for (const sess of sessions) {
        if (sess.id === sessionId) return sess.hasTerminal === false;
      }
    }
    return false;
  });

  // Revoke blob URL on cleanup or when image changes
  useEffect(() => {
    return () => {
      if (pendingImage?.previewUrl) {
        URL.revokeObjectURL(pendingImage.previewUrl);
      }
    };
  }, [pendingImage]);

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

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = '68px';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 144) + 'px';
    }
  }, [text, interimTranscript]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      // Create lightweight blob URL for preview (not a base64 duplicate)
      const previewUrl = URL.createObjectURL(file);
      const processed = await processImageFile(file);
      // Revoke old preview if replacing
      if (pendingImage?.previewUrl) {
        URL.revokeObjectURL(pendingImage.previewUrl);
      }
      setPendingImage({
        base64: processed.base64,
        filename: processed.filename,
        mimeType: processed.mimeType,
        previewUrl,
        sizeBytes: processed.sizeBytes,
      });
    } catch (err) {
      console.error('Failed to process image:', err);
    }
    // Reset so the same file can be re-selected
    e.target.value = '';
  };

  const removePendingImage = () => {
    if (pendingImage?.previewUrl) {
      URL.revokeObjectURL(pendingImage.previewUrl);
    }
    setPendingImage(null);
  };

  const handleSend = async () => {
    const trimmed = text.trim();
    if (!trimmed && !pendingImage) return;
    if (sending) return;

    setSending(true);
    try {
      if (pendingImage) {
        await sendMessage(sessionId, trimmed, {
          base64: pendingImage.base64,
          filename: pendingImage.filename,
          mimeType: pendingImage.mimeType,
        });
      } else {
        await sendMessage(sessionId, trimmed);
      }
      setText('');
      removePendingImage();
      setSendPop(true);
      setTimeout(() => setSendPop(false), 250);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
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

  const MODE_CYCLE: AgentMode[] = ['default', 'acceptEdits', 'plan', 'bypassPermissions'];
  const MODE_LABELS: Record<AgentMode, string> = {
    default: 'DEFAULT',
    acceptEdits: 'EDITS',
    plan: 'PLAN',
    bypassPermissions: 'BYPASS',
  };

  const cycleMode = () => {
    const current = mode ?? 'default';
    const idx = MODE_CYCLE.indexOf(current);
    const next = MODE_CYCLE[(idx + 1) % MODE_CYCLE.length];
    setMode(sessionId, next);
  };

  const canSend = (text.trim() || pendingImage) && !sending;

  return (
    <div className="input-bar-wrapper">
      {noTerminal && (
        <div className="input-no-terminal-notice">
          Terminal offline — will auto-relaunch on send
        </div>
      )}
      {pendingImage && (
        <div className="image-preview-strip">
          <img
            src={pendingImage.previewUrl}
            alt="Attachment preview"
            className="image-preview-thumb"
          />
          <span className="image-preview-info">
            {pendingImage.filename} ({Math.round(pendingImage.sizeBytes / 1024)}KB)
            {sending && ' — Sending...'}
          </span>
          <button
            className="image-preview-remove"
            onClick={removePendingImage}
            aria-label="Remove image"
            type="button"
            disabled={sending}
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
            </svg>
          </button>
        </div>
      )}

      <div className="input-bar">
        <div className="left-controls">
          <button className="mode-btn active" onClick={cycleMode}>
            {MODE_LABELS[mode ?? 'default']}
          </button>
        </div>

        <textarea
          ref={textareaRef}
          className="input-textarea"
          value={isListening ? displayValue : text}
          onChange={(e) => { if (!isListening) setText(e.target.value); }}
          onKeyDown={handleKeyDown}
          placeholder={isListening ? 'Listening...' : 'Ask anything...'}
          rows={1}
          readOnly={isListening || sending}
        />

        <div className="right-controls">
          <button
            className="attach-btn"
            onClick={() => fileInputRef.current?.click()}
            aria-label="Attach image"
            type="button"
            disabled={sending}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
              <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
            </svg>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileSelect}
            style={{ display: 'none' }}
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
          <button className={`send-btn${canSend ? ' send-btn-active' : ''}${sendPop ? ' send-pop' : ''}`} onClick={handleSend} disabled={!canSend}>
            {sending ? 'SENDING' : 'SEND'}
          </button>
        </div>
      </div>
    </div>
  );
}
