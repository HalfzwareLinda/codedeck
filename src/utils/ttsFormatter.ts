/**
 * Converts OutputEntry metadata into concise spoken text for TTS.
 */

import type { OutputEntry } from '../types';

export function formatForSpeech(entry: OutputEntry): string {
  const special = entry.metadata?.special as string | undefined;
  if (!special) return '';

  switch (special) {
    case 'permission_request': {
      const toolName = (entry.metadata?.tool_name as string) ?? 'a tool';
      // First line of description, capped for brevity
      const desc = entry.content?.split('\n')[0]?.slice(0, 120) ?? '';
      const suffix = desc ? `. ${desc}` : '';
      return `${toolName} needs permission${suffix}. Say allow, always, or deny.`;
    }

    case 'plan_approval': {
      const hasPlan = entry.metadata?.has_plan !== false;
      if (!hasPlan) {
        return 'Exit plan mode? Say yes or no.';
      }
      return 'Plan ready for approval. Say: approve edits, approve yolo, or revise.';
    }

    case 'ask_question': {
      const header = (entry.metadata?.header as string) ?? '';
      const questionText = entry.content ?? '';
      const options = entry.metadata?.options as Array<{ label: string }> | undefined;

      let text = header ? `${header}. ` : '';
      text += questionText;

      if (options && options.length > 0) {
        const optList = options
          .map((o, i) => `Option ${i + 1}: ${o.label}`)
          .join('. ');
        text += `. ${optList}.`;
      } else {
        text += '. Dictate your answer, then say send.';
      }
      return text;
    }

    default:
      return '';
  }
}

/**
 * Build a session-switch summary for TTS.
 */
export function formatSessionSwitchSummary(
  pendingCount: number,
  latestEntry: OutputEntry | null,
): string {
  if (pendingCount === 0) return '';

  const latest = latestEntry ? formatForSpeech(latestEntry) : '';

  if (pendingCount === 1) {
    return latest;
  }

  return `${pendingCount} pending items. Latest: ${latest}`;
}
