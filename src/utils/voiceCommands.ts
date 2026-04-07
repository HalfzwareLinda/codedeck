/**
 * Context-aware voice command parser.
 *
 * Maps STT transcripts to actionable intents based on the current
 * interactive card type being presented to the user.
 */

export type VoiceContext =
  | 'idle'
  | 'permission'
  | 'plan_approval'
  | 'plan_approval_no_plan'
  | 'question'
  | 'dictating';

export type VoiceAction =
  | { type: 'keypress'; key: string; label: string }
  | { type: 'dictation_start' }
  | { type: 'dictation_submit'; text: string }
  | { type: 'dictation_cancel' }
  | { type: 'read_back' }
  | { type: 'read_plan' }
  | { type: 'skip' }
  | { type: 'stop' }
  | { type: 'repeat' }
  | { type: 'unrecognized' };

// Number words → digits (pre-compiled patterns for parseQuestion)
const WORD_NUMBERS: Array<{ pattern: RegExp; digit: string }> = [
  { pattern: /\b(one|1)\b/, digit: '1' },
  { pattern: /\b(two|2)\b/, digit: '2' },
  { pattern: /\b(three|3)\b/, digit: '3' },
  { pattern: /\b(four|4)\b/, digit: '4' },
  { pattern: /\b(five|5)\b/, digit: '5' },
  { pattern: /\b(first)\b/, digit: '1' },
  { pattern: /\b(second)\b/, digit: '2' },
  { pattern: /\b(third)\b/, digit: '3' },
  { pattern: /\b(fourth)\b/, digit: '4' },
  { pattern: /\b(fifth)\b/, digit: '5' },
];

function normalize(transcript: string): string {
  return transcript.toLowerCase().trim();
}

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(text));
}

// --- Terminator detection for dictation mode ---

const TERMINATORS = /\b(send|done|submit)\s*$/;

function extractDictationSubmit(text: string): string | null {
  const match = text.match(TERMINATORS);
  if (!match) return null;
  return text.slice(0, match.index).trim();
}

// --- Context-specific parsers ---

function parsePermission(t: string): VoiceAction {
  if (matchesAny(t, [/\balways\b/])) {
    return { type: 'keypress', key: '2', label: 'Always allow' };
  }
  if (matchesAny(t, [/\b(allow|yes|ok|approve|accept)\b/])) {
    return { type: 'keypress', key: '1', label: 'Allow' };
  }
  if (matchesAny(t, [/\b(deny|no|reject|refuse|block)\b/])) {
    return { type: 'keypress', key: '3', label: 'Deny' };
  }
  return { type: 'unrecognized' };
}

function parsePlanApproval(t: string): VoiceAction {
  if (matchesAny(t, [/\bread\s*plan\b/])) {
    return { type: 'read_plan' };
  }
  if (matchesAny(t, [/\b(revise|change|modify|three|option three)\b/])) {
    return { type: 'dictation_start' };
  }
  if (matchesAny(t, [/\b(yolo|approve all|option two|two)\b/]) && !/\bedits?\b/.test(t)) {
    return { type: 'keypress', key: '2', label: 'Approve YOLO' };
  }
  if (matchesAny(t, [/\b(approve edits?|edits?|option one|one)\b/])) {
    return { type: 'keypress', key: '1', label: 'Approve EDITS' };
  }
  return { type: 'unrecognized' };
}

function parsePlanApprovalNoPlan(t: string): VoiceAction {
  if (matchesAny(t, [/\b(yes|exit|one|option one|leave)\b/])) {
    return { type: 'keypress', key: '1', label: 'Yes' };
  }
  if (matchesAny(t, [/\b(no|stay|two|option two|remain)\b/])) {
    return { type: 'keypress', key: '2', label: 'No' };
  }
  return { type: 'unrecognized' };
}

function parseQuestion(t: string): VoiceAction {
  // Check for "type" / "own answer" → free text
  if (matchesAny(t, [/\b(type|own answer|custom|other)\b/])) {
    return { type: 'dictation_start' };
  }

  // Match number words and digits
  for (const { pattern, digit } of WORD_NUMBERS) {
    if (pattern.test(t)) {
      return { type: 'keypress', key: digit, label: `Option ${digit}` };
    }
  }

  return { type: 'unrecognized' };
}

function parseDictating(t: string): VoiceAction {
  if (matchesAny(t, [/^(cancel|nevermind|never mind)$/])) {
    return { type: 'dictation_cancel' };
  }
  if (matchesAny(t, [/\bread\s*back\b/])) {
    return { type: 'read_back' };
  }
  const submitted = extractDictationSubmit(t);
  if (submitted !== null) {
    return { type: 'dictation_submit', text: submitted };
  }
  // Not a command — treat as dictation content (accumulated by caller)
  return { type: 'unrecognized' };
}

// --- Universal commands (checked first in every context except dictating) ---

function parseUniversal(t: string): VoiceAction | null {
  if (matchesAny(t, [/^(skip|next)$/])) return { type: 'skip' };
  if (matchesAny(t, [/^stop$/])) return { type: 'stop' };
  if (matchesAny(t, [/^repeat$/])) return { type: 'repeat' };
  return null;
}

// --- Main parser ---

export function parseVoiceCommand(transcript: string, context: VoiceContext): VoiceAction {
  const t = normalize(transcript);
  if (!t) return { type: 'unrecognized' };

  // In dictation mode, only check dictation-specific commands
  if (context === 'dictating') {
    return parseDictating(t);
  }

  // Universal commands first
  const universal = parseUniversal(t);
  if (universal) return universal;

  switch (context) {
    case 'permission':
      return parsePermission(t);
    case 'plan_approval':
      return parsePlanApproval(t);
    case 'plan_approval_no_plan':
      return parsePlanApprovalNoPlan(t);
    case 'question':
      return parseQuestion(t);
    case 'idle':
    default:
      return { type: 'unrecognized' };
  }
}
