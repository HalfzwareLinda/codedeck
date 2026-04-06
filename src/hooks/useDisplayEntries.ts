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

export interface PlanApprovalDisplay extends DisplayEntryBase {
  kind: 'plan_approval';
  entry: OutputEntry;
  answered?: string;
}

export interface QuestionDisplay extends DisplayEntryBase {
  kind: 'question';
  entry: OutputEntry;
  header?: string;
  options?: Array<{ label: string; description?: string }>;
  answered?: string;
}

export interface QuestionGroupQuestion {
  entry: OutputEntry;
  header?: string;
  options?: Array<{ label: string; description?: string }>;
  multiSelect?: boolean;
}

export interface QuestionGroupDisplay extends DisplayEntryBase {
  kind: 'question_group';
  toolUseId: string;
  questions: QuestionGroupQuestion[];
  answered?: string;
}

export interface PermissionRequestDisplay extends DisplayEntryBase {
  kind: 'permission_request';
  entry: OutputEntry;
  toolName: string;
  description: string;
  requestId: string;
}

export interface PlanConfirmationDisplay extends DisplayEntryBase {
  kind: 'plan_confirmation';
  entry: OutputEntry;
}

export type DisplayEntry =
  | UserMessageDisplay
  | AssistantMessageDisplay
  | ToolGroupDisplay
  | ErrorDisplay
  | SystemDisplay
  | DiffDisplay
  | PlanApprovalDisplay
  | QuestionDisplay
  | QuestionGroupDisplay
  | PermissionRequestDisplay
  | PlanConfirmationDisplay;

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
 * Collect tool_use_ids that have a matching tool_result response,
 * mapping each to the answer content text.
 */
function collectAnsweredToolUseIds(outputs: OutputEntry[]): Map<string, string> {
  const answered = new Map<string, string>();
  for (const entry of outputs) {
    if (entry.entry_type === 'tool_result') {
      const id = entry.metadata?.tool_use_id as string | undefined;
      if (id) answered.set(id, entry.content);
    }
  }
  return answered;
}

/**
 * Transforms a flat OutputEntry[] into grouped DisplayEntry[].
 * - Consecutive tool entries are merged into tool_group items
 * - Answered plan_approval / ask_question entries shown in completed state
 * - Answered permission_request entries are omitted (bridge pre-filters for history)
 * - token_usage entries are handled upstream in the store (never reach here)
 */
function buildDisplayEntries(outputs: OutputEntry[]): DisplayEntry[] {
  const display: DisplayEntry[] = [];
  let currentToolGroup: OutputEntry[] = [];
  let toolGroupStart = 0;
  const answeredMap = collectAnsweredToolUseIds(outputs);
  let lastWasPlanApproval = false;

  // Question group buffering (groups consecutive ask_question entries with same tool_use_id)
  let pendingQuestions: QuestionGroupQuestion[] = [];
  let pendingQuestionToolUseId: string | null = null;
  let pendingQuestionStart = 0;

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

  function flushQuestionGroup() {
    if (pendingQuestions.length === 0) return;
    const toolUseId = pendingQuestionToolUseId!;
    const answerContent = answeredMap.get(toolUseId);
    // Check metadata for expected question count (bridge v0.3.4+ includes question_index/question_count)
    const expectedCount = pendingQuestions[0].entry.metadata?.question_count as number | undefined;
    const isMulti = expectedCount != null ? expectedCount > 1 : pendingQuestions.length > 1;
    if (!isMulti) {
      // Single question — emit as regular QuestionDisplay (no tabs needed)
      const q = pendingQuestions[0];
      display.push({
        kind: 'question',
        entry: q.entry,
        header: q.header,
        options: q.options,
        sourceStart: pendingQuestionStart,
        answered: answerContent,
      });
    } else {
      // Sort by question_index if available (robust against out-of-order delivery)
      pendingQuestions.sort((a, b) => {
        const ai = (a.entry.metadata?.question_index as number) ?? 0;
        const bi = (b.entry.metadata?.question_index as number) ?? 0;
        return ai - bi;
      });
      display.push({
        kind: 'question_group',
        toolUseId,
        questions: pendingQuestions,
        sourceStart: pendingQuestionStart,
        answered: answerContent,
      });
    }
    pendingQuestions = [];
    pendingQuestionToolUseId = null;
  }

  for (let i = 0; i < outputs.length; i++) {
    const entry = outputs[i];

    // Group consecutive tool entries
    if (isToolEntry(entry)) {
      flushQuestionGroup();
      if (currentToolGroup.length === 0) {
        toolGroupStart = i;
      }
      currentToolGroup.push(entry);
      continue;
    }

    // Non-tool entry — flush any pending tool group first
    flushToolGroup();

    const special = entry.metadata?.special as string | undefined;
    const toolUseId = entry.metadata?.tool_use_id as string | undefined;

    // Buffer consecutive ask_question entries with same tool_use_id
    if (special === 'ask_question') {
      if (pendingQuestionToolUseId && toolUseId !== pendingQuestionToolUseId) {
        flushQuestionGroup();
      }
      if (pendingQuestions.length === 0) {
        pendingQuestionStart = i;
        pendingQuestionToolUseId = toolUseId ?? null;
      }
      pendingQuestions.push({
        entry,
        header: entry.metadata?.header as string | undefined,
        options: entry.metadata?.options as Array<{ label: string; description?: string }> | undefined,
        multiSelect: entry.metadata?.multiSelect as boolean | undefined,
      });
      continue;
    }

    // Non-question entry — flush any pending question group
    flushQuestionGroup();

    // Skip answered permission_request entries (bridge pre-filters these for history)
    if (special === 'permission_request' && toolUseId && answeredMap.has(toolUseId)) {
      continue;
    }

    // Plan text entry (emitted by bridge before plan_approval with same tool_use_id).
    // After approval: show as collapsible "Plan approved". Before: show as readable text.
    if (special === 'plan') {
      const isAnswered = toolUseId && answeredMap.has(toolUseId);
      if (isAnswered) {
        display.push({ kind: 'plan_confirmation', entry, sourceStart: i });
      } else {
        display.push({ kind: 'assistant_message', entry, sourceStart: i });
      }
      continue;
    }

    if (special === 'plan_approval') {
      // Use short label instead of raw tool_result content for answered state
      const isAnswered = toolUseId ? answeredMap.has(toolUseId) : false;
      display.push({ kind: 'plan_approval', entry, sourceStart: i, answered: isAnswered ? 'Plan approved' : undefined });
      lastWasPlanApproval = true;
      continue;
    }
    if (special === 'permission_request') {
      display.push({
        kind: 'permission_request',
        entry,
        toolName: (entry.metadata?.tool_name as string) ?? '',
        description: entry.content,
        requestId: toolUseId ?? '',
        sourceStart: i,
      });
      continue;
    }

    switch (entry.entry_type) {
      case 'user_message':
        display.push({ kind: 'user_message', entry, sourceStart: i });
        lastWasPlanApproval = false;
        break;
      case 'text':
      case 'message':
        if (lastWasPlanApproval) {
          display.push({ kind: 'plan_confirmation', entry, sourceStart: i });
        } else {
          display.push({ kind: 'assistant_message', entry, sourceStart: i });
        }
        lastWasPlanApproval = false;
        break;
      case 'error':
        display.push({ kind: 'error', entry, sourceStart: i });
        lastWasPlanApproval = false;
        break;
      case 'diff':
        display.push({ kind: 'diff', entry, sourceStart: i });
        lastWasPlanApproval = false;
        break;
      case 'system':
        // Don't reset lastWasPlanApproval — token usage entries follow plan_approval
        display.push({ kind: 'system', entry, sourceStart: i });
        break;
      default:
        display.push({ kind: 'assistant_message', entry, sourceStart: i });
        lastWasPlanApproval = false;
    }
  }

  // Flush any trailing groups
  flushQuestionGroup();
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
