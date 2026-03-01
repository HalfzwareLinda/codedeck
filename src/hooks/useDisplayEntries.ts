import { useMemo, useState, useCallback } from 'react';
import { OutputEntry } from '../types';

export interface DisplayEntryBase {
  /** Original index range in the source array, used for stable keys */
  sourceStart: number;
}

export interface UserMessageDisplay extends DisplayEntryBase {
  kind: 'user_message';
  entry: OutputEntry;
}

export interface AssistantMessageDisplay extends DisplayEntryBase {
  kind: 'assistant_message';
  entry: OutputEntry;
}

export interface ToolGroupDisplay extends DisplayEntryBase {
  kind: 'tool_group';
  entries: OutputEntry[];
  summary: string;
}

export interface ErrorDisplay extends DisplayEntryBase {
  kind: 'error';
  entry: OutputEntry;
}

export interface SystemDisplay extends DisplayEntryBase {
  kind: 'system';
  entry: OutputEntry;
}

export interface DiffDisplay extends DisplayEntryBase {
  kind: 'diff';
  entry: OutputEntry;
}

export type DisplayEntry =
  | UserMessageDisplay
  | AssistantMessageDisplay
  | ToolGroupDisplay
  | ErrorDisplay
  | SystemDisplay
  | DiffDisplay;

const TOOL_ENTRY_TYPES = new Set(['tool_use', 'tool_result', 'action']);

function isToolEntry(entry: OutputEntry): boolean {
  return TOOL_ENTRY_TYPES.has(entry.entry_type);
}

/** Build a summary string for a group of tool entries, e.g. "3 actions — Bash, Edit, Read" */
function buildToolSummary(entries: OutputEntry[]): string {
  const toolNames: string[] = [];
  for (const e of entries) {
    const name = e.metadata?.tool_name as string | undefined;
    if (name && !toolNames.includes(name)) {
      toolNames.push(name);
    } else if (!name && e.entry_type === 'tool_use') {
      // Try to extract tool name from content (e.g., "Bash: ...")
      const match = e.content.match(/^(\w+):/);
      if (match && !toolNames.includes(match[1])) {
        toolNames.push(match[1]);
      }
    }
  }
  const count = entries.length;
  const names = toolNames.length > 0 ? toolNames.join(', ') : 'tools';
  return `${count} action${count !== 1 ? 's' : ''} — ${names}`;
}

/**
 * Transforms a flat OutputEntry[] into grouped DisplayEntry[].
 * - Consecutive tool entries are merged into tool_group items
 * - token_usage entries are handled upstream in the store (never reach here)
 */
function buildDisplayEntries(outputs: OutputEntry[]): DisplayEntry[] {
  const display: DisplayEntry[] = [];
  let currentToolGroup: OutputEntry[] = [];
  let toolGroupStart = 0;

  function flushToolGroup() {
    if (currentToolGroup.length > 0) {
      display.push({
        kind: 'tool_group',
        entries: currentToolGroup,
        summary: buildToolSummary(currentToolGroup),
        sourceStart: toolGroupStart,
      });
      currentToolGroup = [];
    }
  }

  for (let i = 0; i < outputs.length; i++) {
    const entry = outputs[i];

    // Group consecutive tool entries
    if (isToolEntry(entry)) {
      if (currentToolGroup.length === 0) {
        toolGroupStart = i;
      }
      currentToolGroup.push(entry);
      continue;
    }

    // Non-tool entry — flush any pending tool group first
    flushToolGroup();

    switch (entry.entry_type) {
      case 'user_message':
        display.push({ kind: 'user_message', entry, sourceStart: i });
        break;
      case 'message':
        display.push({ kind: 'assistant_message', entry, sourceStart: i });
        break;
      case 'error':
        display.push({ kind: 'error', entry, sourceStart: i });
        break;
      case 'diff':
        display.push({ kind: 'diff', entry, sourceStart: i });
        break;
      case 'system':
        display.push({ kind: 'system', entry, sourceStart: i });
        break;
      default:
        display.push({ kind: 'assistant_message', entry, sourceStart: i });
    }
  }

  // Flush any trailing tool group
  flushToolGroup();

  return display;
}

/**
 * Hook that transforms flat OutputEntry[] into grouped DisplayEntry[],
 * and manages collapse state for tool groups.
 *
 * Collapse state is keyed by `sourceStart` (stable index into the source
 * OutputEntry array) rather than display index, so expanding a group
 * survives new entries being appended to the stream.
 */
export function useDisplayEntries(outputs: OutputEntry[]) {
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());

  const display = useMemo(() => buildDisplayEntries(outputs), [outputs]);

  const toggleGroup = useCallback((sourceStart: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(sourceStart)) {
        next.delete(sourceStart);
      } else {
        next.add(sourceStart);
      }
      return next;
    });
  }, []);

  const isExpanded = useCallback((sourceStart: number) => expanded.has(sourceStart), [expanded]);

  return { display, toggleGroup, isExpanded };
}
