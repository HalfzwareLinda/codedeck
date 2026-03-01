import { useEffect, useState, useCallback, CSSProperties } from 'react';
import Markdown from 'react-markdown';
import { List, useListRef, useDynamicRowHeight } from 'react-window';
import { useSessionStore } from '../stores/sessionStore';
import { OutputEntry } from '../types';
import {
  useDisplayEntries,
  DisplayEntry,
  ToolGroupDisplay,
} from '../hooks/useDisplayEntries';
import '../styles/output.css';

const EMPTY_OUTPUTS: OutputEntry[] = [];
const DEFAULT_ROW_HEIGHT = 40;

// --- Entry-level components ---

function UserMessageBubble({ entry }: { entry: OutputEntry }) {
  return (
    <div className="user-message-row">
      <div className="user-message-bubble">
        <Markdown>{entry.content}</Markdown>
      </div>
    </div>
  );
}

function AssistantMessage({ entry }: { entry: OutputEntry }) {
  return (
    <div className="assistant-message">
      <Markdown>{entry.content}</Markdown>
    </div>
  );
}

function ToolGroupEntry({
  item,
  expanded,
  onToggle,
}: {
  item: ToolGroupDisplay;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="tool-group">
      <button className="tool-group-header" onClick={onToggle}>
        <span className={`tool-group-chevron${expanded ? ' tool-group-chevron-open' : ''}`}>
          &#x25B8;
        </span>
        <span className="tool-group-summary">{item.summary}</span>
      </button>
      {expanded && (
        <div className="tool-group-body">
          {item.entries.map((entry, i) => (
            <div key={i} className="tool-group-item">
              {entry.content}
            </div>
          ))}
        </div>
      )}
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

function ErrorEntry({ entry }: { entry: OutputEntry }) {
  return <div className="output-error">{entry.content}</div>;
}

function SystemEntry({ entry }: { entry: OutputEntry }) {
  if (!entry.content) return null;
  return <div className="output-system">{entry.content}</div>;
}

// --- Display item dispatcher ---

function DisplayItem({
  item,
  expanded,
  onToggle,
}: {
  item: DisplayEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  switch (item.kind) {
    case 'user_message':
      return <UserMessageBubble entry={item.entry} />;
    case 'assistant_message':
      return <AssistantMessage entry={item.entry} />;
    case 'tool_group':
      return <ToolGroupEntry item={item} expanded={expanded} onToggle={onToggle} />;
    case 'error':
      return <ErrorEntry entry={item.entry} />;
    case 'system':
      return <SystemEntry entry={item.entry} />;
    case 'diff':
      return <DiffEntry entry={item.entry} />;
    default:
      return null;
  }
}

// --- Row component for react-window ---

interface RowProps {
  display: DisplayEntry[];
  isExpanded: (sourceStart: number) => boolean;
  toggleGroup: (sourceStart: number) => void;
}

function OutputRow({
  index,
  style,
  display,
  isExpanded,
  toggleGroup,
}: {
  index: number;
  style: CSSProperties;
  ariaAttributes: { 'aria-posinset': number; 'aria-setsize': number; role: 'listitem' };
  display: DisplayEntry[];
  isExpanded: (sourceStart: number) => boolean;
  toggleGroup: (sourceStart: number) => void;
}) {
  const item = display[index];
  const expanded = item.kind === 'tool_group' ? isExpanded(item.sourceStart) : false;
  const onToggle = useCallback(() => toggleGroup(item.sourceStart), [toggleGroup, item.sourceStart]);

  return (
    <div style={style}>
      <DisplayItem item={item} expanded={expanded} onToggle={onToggle} />
    </div>
  );
}

// --- Main component ---

export default function OutputStream({ sessionId }: { sessionId: string }) {
  const outputs = useSessionStore((s) => s.outputs[sessionId] ?? EMPTY_OUTPUTS);
  const isLoading = useSessionStore((s) => !!s.historyLoading[sessionId]);
  const { display, toggleGroup, isExpanded } = useDisplayEntries(outputs);

  const listRef = useListRef(null);
  const dynamicHeight = useDynamicRowHeight({ defaultRowHeight: DEFAULT_ROW_HEIGHT });
  const [autoScroll, setAutoScroll] = useState(true);
  const [showPill, setShowPill] = useState(false);
  const [prevCount, setPrevCount] = useState(0);

  // Auto-scroll to bottom when new display entries arrive
  useEffect(() => {
    if (display.length > prevCount) {
      if (autoScroll && listRef.current) {
        listRef.current.scrollToRow({ index: display.length - 1, align: 'end' });
      } else if (!autoScroll) {
        setShowPill(true);
      }
      setPrevCount(display.length);
    }
  }, [display.length, autoScroll, prevCount, listRef]);

  // Scroll to bottom on initial load (fix for history sessions)
  useEffect(() => {
    if (display.length > 0 && prevCount === 0) {
      // Small delay to let react-window measure row heights
      const timer = setTimeout(() => {
        if (listRef.current) {
          listRef.current.scrollToRow({ index: display.length - 1, align: 'end' });
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [display.length, prevCount, listRef]);

  // On resize, re-scroll if auto-scroll is on
  const handleResize = useCallback((_size: { height: number; width: number }) => {
    if (autoScroll && listRef.current && display.length > 0) {
      listRef.current.scrollToRow({ index: display.length - 1, align: 'end' });
    }
  }, [autoScroll, display.length, listRef]);

  const scrollToBottom = useCallback(() => {
    if (listRef.current && display.length > 0) {
      listRef.current.scrollToRow({ index: display.length - 1, align: 'end' });
      setAutoScroll(true);
      setShowPill(false);
    }
  }, [display.length, listRef]);

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

  const rowProps: RowProps = { display, isExpanded, toggleGroup };

  return (
    <div className="output-container">
      {display.length === 0 ? (
        <div className="output-scroll">
          <div className="output-empty">
            {isLoading ? 'Loading session history...' : 'Send a message to start the agent'}
          </div>
        </div>
      ) : (
        <List<RowProps>
          listRef={listRef}
          className="output-virtual-list"
          rowCount={display.length}
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
