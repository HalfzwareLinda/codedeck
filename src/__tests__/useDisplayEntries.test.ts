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
  it('absorbs bridge-tagged agent_prompt entries into tool group', () => {
    const outputs: OutputEntry[] = [
      makeText('Let me explore the codebase.', { agent_prompt: true }),
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

  it('absorbs bridge-tagged subagent text into tool group', () => {
    const outputs: OutputEntry[] = [
      makeToolUse('Agent', 'Agent: Explore (Explore)'),
      makeText('Searching the codebase...', { subagent: true }),
      makeToolUse('Read', 'Read: /src/main.ts'),
      makeToolResult('file contents'),
      makeText('Here are my findings.', { subagent: true }),
      makeToolResult('Agent result'),
    ];

    const display = buildDisplayEntries(outputs);
    expect(display).toHaveLength(1);
    expect(display[0].kind).toBe('tool_group');
  });

  it('does NOT absorb plan text (special: plan)', () => {
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

  it('does NOT absorb final response text (last text before end)', () => {
    const outputs: OutputEntry[] = [
      makeToolUse('Bash', 'Bash: ls'),
      makeToolResult('file1.ts'),
      makeText('Based on my analysis, the issue is in file1.ts.'),
    ];

    const display = buildDisplayEntries(outputs);
    expect(display).toHaveLength(2);
    expect(display[0].kind).toBe('tool_group');
    expect(display[1].kind).toBe('assistant_message');
  });

  it('backward compat: non-tagged text with tool lookahead still absorbed', () => {
    const outputs: OutputEntry[] = [
      makeText('Let me check that file.'),
      makeToolUse('Read', 'Read: /src/main.ts'),
      makeToolResult('file contents'),
      makeText('The file looks fine.'),
    ];

    const display = buildDisplayEntries(outputs);
    expect(display).toHaveLength(2);
    expect(display[0].kind).toBe('tool_group');
    expect(display[1].kind).toBe('assistant_message');
    if (display[1].kind === 'assistant_message') {
      expect(display[1].entry.content).toBe('The file looks fine.');
    }
  });

  it('tool group summary counts only actual tool entries', () => {
    const outputs: OutputEntry[] = [
      makeText('Exploring...', { agent_prompt: true }),
      makeToolUse('Agent', 'Agent: Explore (Explore)'),
      makeText('Sub-agent working...', { subagent: true }),
      makeToolUse('Read', 'Read: /src/main.ts'),
      makeToolResult('contents'),
    ];

    const display = buildDisplayEntries(outputs);
    expect(display).toHaveLength(1);
    if (display[0].kind === 'tool_group') {
      expect(display[0].summary).toMatch(/^3 action/);
    }
  });

  it('absorbs agent_prompt text even when no tool group is active yet', () => {
    const outputs: OutputEntry[] = [
      makeText('I will investigate the IPC issue by searching...', { agent_prompt: true }),
      makeToolUse('Agent', 'Agent: Explore IPC (Explore)'),
    ];

    const display = buildDisplayEntries(outputs);
    expect(display).toHaveLength(1);
    expect(display[0].kind).toBe('tool_group');
  });

  it('does not absorb user messages even with subagent flag', () => {
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
});
