import { useState, useRef, useEffect } from 'react';
import { Session, AgentMode } from '../types';
import { useSessionStore } from '../stores/sessionStore';

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
        onClick={() => setMode(session.id, mode)}
        style={{
          padding: '4px 12px',
          fontSize: 12,
          fontWeight: 700,
          borderRadius: 4,
          cursor: 'pointer',
          background: isActive ? 'var(--text-primary)' : 'var(--bg-card)',
          color: isActive ? 'var(--bg-black)' : 'var(--text-muted)',
          border: isActive ? 'none' : '1px solid var(--border-medium)',
          height: 32,
          minWidth: 60,
        }}
      >
        {label}
      </button>
    );
  };

  return (
    <div style={{
      borderTop: '1px solid var(--border-medium)',
      padding: '8px 16px',
      display: 'flex',
      gap: 8,
      alignItems: 'flex-end',
      flexShrink: 0,
    }}>
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Ask anything..."
        rows={1}
        style={{
          flex: 1,
          minHeight: 48,
          maxHeight: 144,
          resize: 'none',
          background: 'var(--bg-input)',
          border: '1px solid var(--border-medium)',
          borderRadius: 8,
          padding: '12px',
          fontSize: 14,
          color: 'var(--text-primary)',
          lineHeight: 1.4,
        }}
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 2 }}>
          {modeButton('plan', 'PLAN')}
          {modeButton('auto', 'AUTO')}
        </div>
        {text.trim() && (
          <button
            onClick={handleSend}
            style={{
              height: 48,
              padding: '0 16px',
              background: 'var(--bg-surface)',
              color: 'var(--text-primary)',
              fontSize: 13,
              fontWeight: 700,
              borderRadius: 4,
              cursor: 'pointer',
              border: '1px solid var(--border-medium)',
            }}
          >
            Ask
          </button>
        )}
      </div>
    </div>
  );
}
