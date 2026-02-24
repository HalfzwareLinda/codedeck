import { useState, useRef, useEffect } from 'react';
import { Session, AgentMode } from '../types';
import { useSessionStore } from '../stores/sessionStore';
import '../styles/input.css';

export default function InputBar({ session }: { session: Session }) {
  const [text, setText] = useState('');
  const sendMessage = useSessionStore((s) => s.sendMessage);
  const setMode = useSessionStore((s) => s.setMode);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = '48px';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 144) + 'px';
    }
  }, [text]);

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
      <textarea
        ref={textareaRef}
        className="input-textarea"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Ask anything..."
        rows={1}
      />

      <div className="input-controls">
        <div className="mode-toggle">
          {modeButton('plan', 'PLAN')}
          {modeButton('auto', 'AUTO')}
        </div>
        {text.trim() && (
          <button className="send-btn" onClick={handleSend}>Ask</button>
        )}
      </div>
    </div>
  );
}
