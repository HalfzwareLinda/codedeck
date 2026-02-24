import { useRef, useEffect, useState } from 'react';
import { useSessionStore } from '../stores/sessionStore';
import { OutputEntry } from '../types';

function ActionEntry({ entry }: { entry: OutputEntry }) {
  return (
    <div style={{
      fontFamily: 'var(--font-mono)',
      fontSize: 13,
      padding: '4px 0',
    }}>
      <span style={{ color: 'var(--text-secondary)' }}>
        {entry.metadata?.tool_type as string || 'Action'}:
      </span>{' '}
      <span style={{ color: 'var(--text-primary)' }}>{entry.content}</span>
    </div>
  );
}

function DiffEntry({ entry }: { entry: OutputEntry }) {
  const lines = entry.content.split('\n');
  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--border-subtle)',
      borderRadius: 8,
      padding: 12,
      fontFamily: 'var(--font-mono)',
      fontSize: 13,
      marginBottom: 4,
      overflowX: 'auto',
    }}>
      {entry.metadata?.filename ? (
        <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>
          {String(entry.metadata.filename)}
        </div>
      ) : null}
      {lines.map((line, i) => {
        const isAdd = line.startsWith('+');
        const isRemove = line.startsWith('-');
        return (
          <div key={i} style={{
            color: isRemove ? 'var(--diff-remove)' : 'var(--diff-add)',
            background: isAdd ? 'var(--diff-add-bg)' : isRemove ? 'var(--diff-remove-bg)' : 'transparent',
            textDecoration: isRemove ? 'line-through' : 'none',
            whiteSpace: 'pre',
          }}>
            {line}
          </div>
        );
      })}
    </div>
  );
}

function MessageEntry({ entry }: { entry: OutputEntry }) {
  // Simple markdown-ish rendering
  const parts = entry.content.split(/(`[^`]+`)/g);
  return (
    <div style={{ fontSize: 14, lineHeight: 1.5, padding: '4px 0' }}>
      {parts.map((part, i) =>
        part.startsWith('`') && part.endsWith('`') ? (
          <code key={i} style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 13,
            background: 'var(--bg-card)',
            padding: '2px 4px',
            borderRadius: 3,
          }}>
            {part.slice(1, -1)}
          </code>
        ) : part.startsWith('**') && part.endsWith('**') ? (
          <strong key={i}>{part.slice(2, -2)}</strong>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </div>
  );
}

function ErrorEntry({ entry }: { entry: OutputEntry }) {
  return (
    <div style={{
      fontSize: 13,
      fontFamily: 'var(--font-mono)',
      color: 'var(--status-error)',
      padding: '4px 0',
    }}>
      {entry.content}
    </div>
  );
}

function SystemEntry({ entry }: { entry: OutputEntry }) {
  return (
    <div style={{
      fontSize: 12,
      color: 'var(--text-muted)',
      fontStyle: 'italic',
      padding: '4px 0',
    }}>
      {entry.content}
    </div>
  );
}

export default function OutputStream({ sessionId }: { sessionId: string }) {
  const outputs = useSessionStore((s) => s.outputs[sessionId] || []);
  const containerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [showNewOutput, setShowNewOutput] = useState(false);

  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    } else if (!autoScroll && outputs.length > 0) {
      setShowNewOutput(true);
    }
  }, [outputs, autoScroll]);

  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const atBottom = scrollHeight - scrollTop - clientHeight < 50;
    setAutoScroll(atBottom);
    if (atBottom) setShowNewOutput(false);
  };

  const scrollToBottom = () => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
      setAutoScroll(true);
      setShowNewOutput(false);
    }
  };

  return (
    <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
      <div
        ref={containerRef}
        onScroll={handleScroll}
        style={{
          height: '100%',
          overflowY: 'auto',
          padding: '8px 16px',
        }}
      >
        {outputs.map((entry, i) => {
          switch (entry.entry_type) {
            case 'action': return <ActionEntry key={i} entry={entry} />;
            case 'diff': return <DiffEntry key={i} entry={entry} />;
            case 'message': return <MessageEntry key={i} entry={entry} />;
            case 'error': return <ErrorEntry key={i} entry={entry} />;
            case 'system': return <SystemEntry key={i} entry={entry} />;
          }
        })}
        {outputs.length === 0 && (
          <div style={{
            color: 'var(--text-muted)',
            fontSize: 13,
            textAlign: 'center',
            paddingTop: 40,
          }}>
            Send a message to start the agent
          </div>
        )}
      </div>

      {showNewOutput && (
        <button
          onClick={scrollToBottom}
          style={{
            position: 'absolute',
            bottom: 8,
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'var(--bg-surface)',
            color: 'var(--text-primary)',
            padding: '8px 16px',
            borderRadius: 18,
            fontSize: 13,
            cursor: 'pointer',
            border: '1px solid var(--border-medium)',
          }}
        >
          ↓ New output
        </button>
      )}
    </div>
  );
}
