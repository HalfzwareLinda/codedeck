import { useEffect, useState, useCallback, useRef, CSSProperties } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { List, useListRef, useDynamicRowHeight } from 'react-window';
import { useSessionStore } from '../stores/sessionStore';
import { OutputEntry } from '../types';
import {
  useDisplayEntries,
  DisplayEntry,
  ToolGroupDisplay,
  PlanApprovalDisplay,
  QuestionDisplay,
  PermissionRequestDisplay,
} from '../hooks/useDisplayEntries';
import '../styles/output.css';

const EMPTY_OUTPUTS: OutputEntry[] = [];
const DEFAULT_ROW_HEIGHT = 40;

// --- Entry-level components ---

const remarkPlugins = [remarkGfm];

function UserMessageBubble({ entry }: { entry: OutputEntry }) {
  const imageFilename = entry.metadata?.imageFilename as string | undefined;
  return (
    <div className="user-message-row">
      <div className="user-message-bubble">
        <Markdown remarkPlugins={remarkPlugins}>{entry.content}</Markdown>
        {imageFilename && (
          <div className="user-message-image-tag">
            <span className="user-message-image-icon">&#x1F4CE;</span>
            {imageFilename.length > 28 ? imageFilename.slice(0, 25) + '...' : imageFilename}
          </div>
        )}
      </div>
    </div>
  );
}

function AssistantMessage({ entry }: { entry: OutputEntry }) {
  return (
    <div className="assistant-message">
      <Markdown remarkPlugins={remarkPlugins}>{entry.content}</Markdown>
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
      <button className="tool-group-header" onClick={onToggle} aria-expanded={expanded}>
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

function PlanApprovalEntry({ sessionId, answered, cardId }: { sessionId: string; answered?: string; cardId?: string }) {
  const sendKeypress = useSessionStore((s) => s.sendRemoteKeypress);
  const markResponded = useSessionStore((s) => s.markCardResponded);
  const responded = useSessionStore((s) => cardId ? s.isCardResponded(sessionId, cardId) : false);
  if (answered) {
    return (
      <div className="plan-approval-bar plan-approval-answered">
        <div className="plan-approval-label">Plan approved</div>
      </div>
    );
  }
  if (responded) {
    return (
      <div className="plan-approval-bar plan-approval-answered">
        <div className="plan-approval-label">Response sent...</div>
      </div>
    );
  }
  const respond = (key: string) => {
    if (cardId) markResponded(sessionId, cardId);
    sendKeypress(sessionId, key);
  };
  return (
    <div className="plan-approval-bar">
      <div className="plan-approval-label">Approve this plan?</div>
      <div className="plan-approval-actions">
        <button className="btn-allow" onClick={() => respond('y')}>
          Approve
        </button>
        <button className="btn-deny" onClick={() => respond('n')}>
          Reject
        </button>
      </div>
    </div>
  );
}

function QuestionEntry({ item, sessionId }: { item: QuestionDisplay; sessionId: string }) {
  const sendKeypress = useSessionStore((s) => s.sendRemoteKeypress);
  const markResponded = useSessionStore((s) => s.markCardResponded);
  const cardId = item.entry.metadata?.tool_use_id as string | undefined;
  const responded = useSessionStore((s) => cardId ? s.isCardResponded(sessionId, cardId) : false);
  if (item.answered) {
    return (
      <div className="question-card question-answered">
        {item.header && <div className="question-header">{item.header}</div>}
        <div className="question-text">{item.entry.content}</div>
        <div className="question-answer">{item.answered}</div>
      </div>
    );
  }
  if (responded) {
    return (
      <div className="question-card question-answered">
        {item.header && <div className="question-header">{item.header}</div>}
        <div className="question-text">{item.entry.content}</div>
        <div className="question-answer">Response sent...</div>
      </div>
    );
  }
  return (
    <div className="question-card">
      {item.header && <div className="question-header">{item.header}</div>}
      <div className="question-text">{item.entry.content}</div>
      {item.options && item.options.length > 0 && (
        <div className="question-options">
          {item.options.map((opt, i) => (
            <button
              key={i}
              className="question-option-btn"
              onClick={() => {
                if (cardId) markResponded(sessionId, cardId);
                sendKeypress(sessionId, String(i + 1));
              }}
            >
              <span className="question-option-label">{opt.label}</span>
              {opt.description && (
                <span className="question-option-desc">{opt.description}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function PermissionRequestEntry({ item, sessionId }: { item: PermissionRequestDisplay; sessionId: string }) {
  const respondRemotePermission = useSessionStore((s) => s.respondRemotePermission);
  const markResponded = useSessionStore((s) => s.markCardResponded);
  const responded = useSessionStore((s) => s.isCardResponded(sessionId, item.requestId));
  if (responded) {
    return (
      <div className="permission-request-card permission-request-answered">
        <div className="plan-approval-label">{item.toolName}</div>
        <div className="output-system" style={{ margin: '4px 0 8px' }}>{item.description}</div>
        <div className="plan-approval-label">Response sent...</div>
      </div>
    );
  }
  const respond = (allow: boolean, modifier?: 'always' | 'never') => {
    markResponded(sessionId, item.requestId);
    respondRemotePermission(sessionId, item.requestId, allow, modifier);
  };
  return (
    <div className="permission-request-card" aria-live="polite">
      <div className="plan-approval-label">{item.toolName}</div>
      <div className="output-system" style={{ margin: '4px 0 8px' }}>{item.description}</div>
      <div className="plan-approval-actions">
        <button className="btn-allow" onClick={() => respond(true)}>
          Allow
        </button>
        <button className="btn-always" onClick={() => respond(true, 'always')}>
          Always
        </button>
        <button className="btn-deny" onClick={() => respond(false)}>
          Deny
        </button>
      </div>
    </div>
  );
}

// --- Display item dispatcher ---

function DisplayItem({
  item,
  expanded,
  onToggle,
  sessionId,
}: {
  item: DisplayEntry;
  expanded: boolean;
  onToggle: () => void;
  sessionId: string;
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
    case 'plan_approval':
      return <PlanApprovalEntry sessionId={sessionId} answered={(item as PlanApprovalDisplay).answered} cardId={(item as PlanApprovalDisplay).entry.metadata?.tool_use_id as string | undefined} />;
    case 'question':
      return <QuestionEntry item={item} sessionId={sessionId} />;
    case 'permission_request':
      return <PermissionRequestEntry item={item} sessionId={sessionId} />;
    default:
      return null;
  }
}

// --- Row component for react-window ---

interface RowProps {
  display: DisplayEntry[];
  isExpanded: (sourceStart: number) => boolean;
  toggleGroup: (sourceStart: number) => void;
  sessionId: string;
}

function OutputRow({
  index,
  style,
  display,
  isExpanded,
  toggleGroup,
  sessionId,
}: {
  index: number;
  style: CSSProperties;
  ariaAttributes: { 'aria-posinset': number; 'aria-setsize': number; role: 'listitem' };
  display: DisplayEntry[];
  isExpanded: (sourceStart: number) => boolean;
  toggleGroup: (sourceStart: number) => void;
  sessionId: string;
}) {
  const item = display[index];
  const expanded = item.kind === 'tool_group' ? isExpanded(item.sourceStart) : false;
  const onToggle = useCallback(() => toggleGroup(item.sourceStart), [toggleGroup, item.sourceStart]);

  return (
    <div style={style}>
      <DisplayItem item={item} expanded={expanded} onToggle={onToggle} sessionId={sessionId} />
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
  const autoScrollRef = useRef(true);
  const displayLenRef = useRef(0);

  // Keep refs in sync so the ResizeObserver callback reads fresh values
  autoScrollRef.current = autoScroll;
  displayLenRef.current = display.length;

  // Reset scroll state on session switch — ensures new sessions open at the bottom
  useEffect(() => {
    setAutoScroll(true);
    autoScrollRef.current = true;
    setShowPill(false);
    setPrevCount(0);

    const t1 = setTimeout(() => {
      if (listRef.current && displayLenRef.current > 0) {
        listRef.current.scrollToRow({ index: displayLenRef.current - 1, align: 'end' });
      }
    }, 50);
    const t2 = setTimeout(() => {
      if (listRef.current && displayLenRef.current > 0) {
        listRef.current.scrollToRow({ index: displayLenRef.current - 1, align: 'end' });
      }
    }, 300);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Show "New output" pill when new entries arrive while user is scrolled away
  useEffect(() => {
    if (display.length > prevCount) {
      if (!autoScroll) {
        setShowPill(true);
      }
      setPrevCount(display.length);
    }
  }, [display.length, autoScroll, prevCount]);

  // Auto-scroll whenever the inner content grows (new entries, streaming, expand, etc.)
  useEffect(() => {
    const el = listRef.current?.element;
    if (!el) return;
    const inner = el.firstElementChild;
    if (!inner) return;
    const observer = new ResizeObserver(() => {
      if (autoScrollRef.current && listRef.current && displayLenRef.current > 0) {
        listRef.current.scrollToRow({ index: displayLenRef.current - 1, align: 'end' });
      }
    });
    observer.observe(inner);
    return () => observer.disconnect();
  }, [listRef]);

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

  // On container resize (orientation change, keyboard), re-scroll if auto-scroll is on
  const handleResize = useCallback((_size: { height: number; width: number }) => {
    if (autoScrollRef.current && listRef.current && displayLenRef.current > 0) {
      listRef.current.scrollToRow({ index: displayLenRef.current - 1, align: 'end' });
    }
  }, [listRef]);

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
    const atBottom = scrollHeight - scrollTop - clientHeight < 150;
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

  const rowProps: RowProps = { display, isExpanded, toggleGroup, sessionId };

  return (
    <div className="output-container" role="log" aria-label="Session output">
      {display.length === 0 ? (
        <div className="output-scroll">
          <div className={`output-empty${isLoading ? ' loading' : ''}`}>
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
