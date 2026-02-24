import { useEffect, useRef, useState, CSSProperties, ReactElement } from 'react';
import Markdown from 'react-markdown';
import { List, useDynamicRowHeight, ListImperativeAPI } from 'react-window';
import { useSessionStore } from '../stores/sessionStore';
import { OutputEntry } from '../types';
import '../styles/output.css';

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

// Row props that we pass via rowProps (excludes ariaAttributes, index, style which List injects)
interface OutputRowProps {
  outputs: OutputEntry[];
  dynamicRowHeight: ReturnType<typeof useDynamicRowHeight>;
}

// react-window v2 rowComponent receives ariaAttributes, index, style (injected) + our OutputRowProps
function RowComponent(props: {
  ariaAttributes: { 'aria-posinset': number; 'aria-setsize': number; role: 'listitem' };
  index: number;
  style: CSSProperties;
} & OutputRowProps): ReactElement | null {
  const { index, style, outputs, dynamicRowHeight } = props;
  const entry = outputs[index];
  if (!entry) return null;

  let content: ReactElement | null;
  switch (entry.entry_type) {
    case 'action': content = <ActionEntry entry={entry} />; break;
    case 'diff': content = <DiffEntry entry={entry} />; break;
    case 'message': content = <MessageEntry entry={entry} />; break;
    case 'error': content = <ErrorEntry entry={entry} />; break;
    case 'system': content = <SystemEntry entry={entry} />; break;
  }

  return (
    <div style={style}>
      <div
        ref={(el) => {
          if (el) {
            dynamicRowHeight.setRowHeight(index, el.getBoundingClientRect().height);
          }
        }}
      >
        {content}
      </div>
    </div>
  );
}

export default function OutputStream({ sessionId }: { sessionId: string }) {
  const outputs = useSessionStore((s) => s.outputs[sessionId] || []);
  const listRef = useRef<ListImperativeAPI>(null);
  const dynamicRowHeight = useDynamicRowHeight({ defaultRowHeight: 28, key: sessionId });
  const [autoScroll, setAutoScroll] = useState(true);

  // Auto-scroll to bottom when new entries arrive
  useEffect(() => {
    if (autoScroll && outputs.length > 0 && listRef.current) {
      try {
        listRef.current.scrollToRow({ index: outputs.length - 1, align: 'end' });
      } catch {
        // Ignore range errors during initial render
      }
    }
  }, [outputs.length, autoScroll]);

  // Track scroll to detect user scrolling away from bottom
  const handleScroll = () => {
    const el = listRef.current?.element;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    setAutoScroll(atBottom);
  };

  if (outputs.length === 0) {
    return (
      <div className="output-container">
        <div className="output-empty">Send a message to start the agent</div>
      </div>
    );
  }

  return (
    <div className="output-container" onScroll={handleScroll}>
      <List<OutputRowProps>
        listRef={listRef}
        rowCount={outputs.length}
        rowHeight={dynamicRowHeight}
        rowComponent={RowComponent}
        rowProps={{ outputs, dynamicRowHeight }}
        overscanCount={10}
        style={{ height: '100%', padding: '8px 16px' }}
      />
      {!autoScroll && (
        <button
          className="output-new-pill"
          onClick={() => {
            setAutoScroll(true);
            if (listRef.current) {
              listRef.current.scrollToRow({ index: outputs.length - 1, align: 'end' });
            }
          }}
        >
          New output
        </button>
      )}
    </div>
  );
}
