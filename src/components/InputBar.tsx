import { useState, useRef, useEffect, useCallback } from 'react';
import { Session, AgentMode } from '../types';
import { useSessionStore } from '../stores/sessionStore';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import '../styles/input.css';

export default function InputBar({ session }: { session: Session }) {
  const [text, setText] = useState('');
  const sendMessage = useSessionStore((s) => s.sendMessage);
  const setMode = useSessionStore((s) => s.setMode);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    sendMessage(session.id, trimmed);
    setText('');
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

  const modeButton = (mode: AgentMode, label: string) => {
    const isActive = session.mode === mode;
    return (
      <button
        className={`mode-btn ${isActive ? 'active' : 'inactive'}`}
        onClick={() => setMode(session.id, mode)}
      >
        {label}
      </button>
    );
  };

  return (
    <div className="input-bar">
      <div className="left-controls">
        <button className="send-btn" onClick={handleSend} disabled={!text.trim()}>SEND</button>
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
      </div>

      <textarea
        ref={textareaRef}
        className="input-textarea"
        value={isListening ? displayValue : text}
        onChange={(e) => { if (!isListening) setText(e.target.value); }}
        onKeyDown={handleKeyDown}
        placeholder={isListening ? 'Listening...' : 'Ask anything...'}
        rows={1}
        readOnly={isListening}
      />

      <div className="right-controls">
        {modeButton('auto', 'BUILD')}
        {modeButton('plan', 'PLAN')}
      </div>
    </div>
  );
}
