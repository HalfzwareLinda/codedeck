import { useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import { useSessionStore } from '../stores/sessionStore';
import { OutputEntry } from '../types';
import '../styles/output.css';

const EMPTY_OUTPUTS: OutputEntry[] = [];

function ActionEntry({ entry }: { entry: OutputEntry }) {
  return (
    <div className="output-action">
      <span className="output-action-type">
        {(entry.metadata?.tool_type as string) || 'Action'}:
      </span>{' '}
      <span className="output-action-detail">{entry.content}</span>
    </div>
  );
}

function DiffEntry({ entry }: { entry: OutputEntry }) {
  const lines = entry.content.split('\n');
  return (
    <div className="output-diff">
      {entry.metadata?.filename ? (
        <div className="output-diff-filename">{String(entry.metadata.filename)}</div>
      ) : null}
      {lines.map((line, i) => {
        const isAdd = line.startsWith('+');
        const isRemove = line.startsWith('-');
        const cls = isRemove ? 'output-diff-remove' : isAdd ? 'output-diff-add' : '';
        return <div key={i} className={cls}>{line}</div>;
      })}
    </div>
  );
}

function MessageEntry({ entry }: { entry: OutputEntry }) {
  return (
    <div className="output-message">
      <Markdown>{entry.content}</Markdown>
    </div>
  );
}

function ErrorEntry({ entry }: { entry: OutputEntry }) {
  return <div className="output-error">{entry.content}</div>;
}

function SystemEntry({ entry }: { entry: OutputEntry }) {
  if (!entry.content) return null;
  return <div className="output-system">{entry.content}</div>;
}

function OutputItem({ entry }: { entry: OutputEntry }) {
  switch (entry.entry_type) {
    case 'action': return <ActionEntry entry={entry} />;
    case 'diff': return <DiffEntry entry={entry} />;
    case 'message': return <MessageEntry entry={entry} />;
    case 'error': return <ErrorEntry entry={entry} />;
    case 'system': return <SystemEntry entry={entry} />;
    default: return null;
  }
}

export default function OutputStream({ sessionId }: { sessionId: string }) {
  const outputs = useSessionStore((s) => s.outputs[sessionId] ?? EMPTY_OUTPUTS);
  const containerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [showPill, setShowPill] = useState(false);

  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    } else if (!autoScroll && outputs.length > 0) {
      setShowPill(true);
    }
  }, [outputs, autoScroll]);

  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const atBottom = scrollHeight - scrollTop - clientHeight < 50;
    setAutoScroll(atBottom);
    if (atBottom) setShowPill(false);
  };

  const scrollToBottom = () => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
      setAutoScroll(true);
      setShowPill(false);
    }
  };

  return (
    <div className="output-container">
      <div
        ref={containerRef}
        className="output-scroll"
        onScroll={handleScroll}
      >
        {outputs.length === 0 ? (
          <div className="output-empty">Send a message to start the agent</div>
        ) : (
          outputs.map((entry, i) => <OutputItem key={i} entry={entry} />)
        )}
      </div>
      {showPill && (
        <button className="output-new-pill" onClick={scrollToBottom}>
          New output
        </button>
      )}
    </div>
  );
}
