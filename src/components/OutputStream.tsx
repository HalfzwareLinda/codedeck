import { useEffect, useState, useCallback, CSSProperties } from 'react';
import Markdown from 'react-markdown';
import { List, useListRef, useDynamicRowHeight } from 'react-window';
import { useSessionStore } from '../stores/sessionStore';
import { OutputEntry } from '../types';
import '../styles/output.css';

const EMPTY_OUTPUTS: OutputEntry[] = [];
const DEFAULT_ROW_HEIGHT = 40;

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

interface RowProps {
  outputs: OutputEntry[];
}

function OutputRow({
  index,
  style,
  outputs,
}: {
  index: number;
  style: CSSProperties;
  ariaAttributes: { 'aria-posinset': number; 'aria-setsize': number; role: 'listitem' };
  outputs: OutputEntry[];
}) {
  const entry = outputs[index];
  return (
    <div style={style}>
      <OutputItem entry={entry} />
    </div>
  );
}

export default function OutputStream({ sessionId }: { sessionId: string }) {
  const outputs = useSessionStore((s) => s.outputs[sessionId] ?? EMPTY_OUTPUTS);
  const listRef = useListRef(null);
  const dynamicHeight = useDynamicRowHeight({ defaultRowHeight: DEFAULT_ROW_HEIGHT });
  const [autoScroll, setAutoScroll] = useState(true);
  const [showPill, setShowPill] = useState(false);
  const [prevCount, setPrevCount] = useState(0);

  // Auto-scroll to bottom when new outputs arrive
  useEffect(() => {
    if (outputs.length > prevCount) {
      if (autoScroll && listRef.current) {
        listRef.current.scrollToRow({ index: outputs.length - 1, align: 'end' });
      } else if (!autoScroll) {
        setShowPill(true);
      }
      setPrevCount(outputs.length);
    }
  }, [outputs.length, autoScroll, prevCount, listRef]);

  // Detect when user scrolls away from bottom
  const handleResize = useCallback((_size: { height: number; width: number }) => {
    // On resize, re-scroll if auto-scroll is on
    if (autoScroll && listRef.current && outputs.length > 0) {
      listRef.current.scrollToRow({ index: outputs.length - 1, align: 'end' });
    }
  }, [autoScroll, outputs.length, listRef]);

  const scrollToBottom = useCallback(() => {
    if (listRef.current && outputs.length > 0) {
      listRef.current.scrollToRow({ index: outputs.length - 1, align: 'end' });
      setAutoScroll(true);
      setShowPill(false);
    }
  }, [outputs.length, listRef]);

  // Track scroll position to detect manual scroll-away
  const handleNativeScroll = useCallback(() => {
    const el = listRef.current?.element;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    const atBottom = scrollHeight - scrollTop - clientHeight < 50;
    setAutoScroll(atBottom);
    if (atBottom) setShowPill(false);
  }, [listRef]);

  // Attach native scroll listener to the list's outer element
  useEffect(() => {
    const el = listRef.current?.element;
    if (!el) return;
    el.addEventListener('scroll', handleNativeScroll);
    return () => el.removeEventListener('scroll', handleNativeScroll);
  }, [listRef, handleNativeScroll]);

  const rowProps: RowProps = { outputs };

  return (
    <div className="output-container">
      {outputs.length === 0 ? (
        <div className="output-scroll">
          <div className="output-empty">Send a message to start the agent</div>
        </div>
      ) : (
        <List<RowProps>
          listRef={listRef}
          className="output-virtual-list"
          rowCount={outputs.length}
          rowHeight={dynamicHeight}
          rowComponent={OutputRow}
          rowProps={rowProps}
          overscanCount={10}
          onResize={handleResize}
          style={{ height: '100%' }}
        />
      )}
      {showPill && (
        <button className="output-new-pill" onClick={scrollToBottom}>
          New output
        </button>
      )}
    </div>
  );
}
