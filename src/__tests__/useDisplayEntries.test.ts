import { describe, it, expect } from 'vitest';
import { OutputEntry } from '../types';
import { _buildDisplayEntries as buildDisplayEntries } from '../hooks/useDisplayEntries';

function makeEntry(overrides: Partial<OutputEntry> = {}): OutputEntry {
  return {
    entry_type: 'message',
    content: 'test',
    timestamp: new Date().toISOString(),
    metadata: { role: 'assistant' },
    ...overrides,
  };
}

function makeToolUse(name = 'Bash', content = 'Bash: ls'): OutputEntry {
  return makeEntry({
    entry_type: 'tool_use',
    content,
    metadata: { role: 'assistant', tool_name: name, tool_use_id: `tool_${Math.random()}` },
  });
}

function makeToolResult(content = 'result'): OutputEntry {
  return makeEntry({
    entry_type: 'tool_result',
    content,
    metadata: { tool_use_id: `tool_${Math.random()}` },
  });
}

function makeText(content: string, extra: Record<string, unknown> = {}): OutputEntry {
  return makeEntry({
    entry_type: 'message',
    content,
    metadata: { role: 'assistant', ...extra },
  });
}

describe('buildDisplayEntries', () => {
  it('collapses text with display_hint collapse into tool group', () => {
    const outputs: OutputEntry[] = [
      makeText('Let me explore the codebase.', { display_hint: 'collapse' }),
      makeToolUse('Agent', 'Agent: Explore (Explore)'),
      makeToolResult('Found 5 files'),
    ];

    const display = buildDisplayEntries(outputs);
    expect(display).toHaveLength(1);
    expect(display[0].kind).toBe('tool_group');
    if (display[0].kind === 'tool_group') {
      expect(display[0].entries).toHaveLength(3);
    }
  });

  it('collapses subagent text with display_hint collapse into tool group', () => {
    const outputs: OutputEntry[] = [
      makeToolUse('Agent', 'Agent: Explore (Explore)'),
      makeText('Searching the codebase...', { subagent: true, display_hint: 'collapse' }),
      makeToolUse('Read', 'Read: /src/main.ts'),
      makeToolResult('file contents'),
      makeText('Here are my findings.', { subagent: true, display_hint: 'collapse' }),
      makeToolResult('Agent result'),
    ];

    const display = buildDisplayEntries(outputs);
    expect(display).toHaveLength(1);
    expect(display[0].kind).toBe('tool_group');
  });

  it('does NOT collapse plan text (special: plan)', () => {
    const outputs: OutputEntry[] = [
      makeEntry({
        entry_type: 'message',
        content: '## My Plan\n1. Fix bug\n2. Add tests',
        metadata: { role: 'assistant', special: 'plan', tool_use_id: 'plan_1' },
      }),
    ];

    const display = buildDisplayEntries(outputs);
    expect(display).toHaveLength(1);
    expect(display[0].kind).toBe('assistant_message');
  });

  it('shows text with display_hint show as individual message', () => {
    const outputs: OutputEntry[] = [
      makeToolUse('Bash', 'Bash: ls'),
      makeToolResult('file1.ts'),
      makeText('Based on my analysis, the issue is in file1.ts.', { display_hint: 'show' }),
    ];

    const display = buildDisplayEntries(outputs);
    expect(display).toHaveLength(2);
    expect(display[0].kind).toBe('tool_group');
    expect(display[1].kind).toBe('assistant_message');
  });

  it('defaults to show when no display_hint is set (old bridge compat)', () => {
    const outputs: OutputEntry[] = [
      makeText('Let me check that file.'),
      makeToolUse('Read', 'Read: /src/main.ts'),
      makeToolResult('file contents'),
      makeText('The file looks fine.'),
    ];

    const display = buildDisplayEntries(outputs);
    // Without display_hint, both texts default to 'show' (not collapsed)
    // text(show) + tool_use+tool_result(group) + text(show) = 3
    expect(display).toHaveLength(3);
    expect(display[0].kind).toBe('assistant_message');
    expect(display[1].kind).toBe('tool_group');
    expect(display[2].kind).toBe('assistant_message');
  });

  it('tool group summary counts only actual tool entries', () => {
    const outputs: OutputEntry[] = [
      makeText('Exploring...', { display_hint: 'collapse' }),
      makeToolUse('Agent', 'Agent: Explore (Explore)'),
      makeText('Sub-agent working...', { display_hint: 'collapse' }),
      makeToolUse('Read', 'Read: /src/main.ts'),
      makeToolResult('contents'),
    ];

    const display = buildDisplayEntries(outputs);
    expect(display).toHaveLength(1);
    if (display[0].kind === 'tool_group') {
      expect(display[0].summary).toMatch(/^3 action/);
    }
  });

  it('collapses display_hint collapse text even when no tool group is active yet', () => {
    const outputs: OutputEntry[] = [
      makeText('I will investigate the IPC issue by searching...', { display_hint: 'collapse' }),
      makeToolUse('Agent', 'Agent: Explore IPC (Explore)'),
    ];

    const display = buildDisplayEntries(outputs);
    expect(display).toHaveLength(1);
    expect(display[0].kind).toBe('tool_group');
  });

  it('does not collapse user messages', () => {
    const outputs: OutputEntry[] = [
      makeToolUse('Bash', 'Bash: ls'),
      makeEntry({
        entry_type: 'user_message',
        content: 'Stop',
        metadata: { role: 'user' },
      }),
    ];

    const display = buildDisplayEntries(outputs);
    expect(display).toHaveLength(2);
    expect(display[0].kind).toBe('tool_group');
    expect(display[1].kind).toBe('user_message');
  });

  it('never collapses plan text even with display_hint collapse', () => {
    const outputs: OutputEntry[] = [
      makeText('I will now propose a plan.', { display_hint: 'collapse' }),
      makeEntry({
        entry_type: 'message',
        content: '## Plan\n1. Step one\n2. Step two',
        metadata: { role: 'assistant', special: 'plan', tool_use_id: 'plan_1', display_hint: 'collapse' },
      }),
      makeEntry({
        entry_type: 'system',
        content: 'Plan approval needed',
        metadata: { special: 'plan_approval', tool_use_id: 'plan_1', has_plan: true },
      }),
    ];

    const display = buildDisplayEntries(outputs);
    // First text collapses into a tool group, plan shows individually, plan_approval shows individually
    expect(display.some(d => d.kind === 'assistant_message')).toBe(true);
    expect(display.some(d => d.kind === 'plan_approval')).toBe(true);
  });
});
