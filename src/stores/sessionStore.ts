import { create } from 'zustand';
import { Session, OutputEntry, AppConfig, AgentMode, TokenUsage } from '../types';
import { api, events, isTauri } from '../ipc/tauri';

interface SessionStore {
  sessions: Session[];
  activeSessionId: string | null;
  outputs: Record<string, OutputEntry[]>;
  config: AppConfig;
  tokenUsage: Record<string, TokenUsage>;

  setActiveSession: (id: string) => void;
  addOutput: (sessionId: string, entry: OutputEntry) => void;
  updateSession: (session: Session) => void;
  updateTokenUsage: (sessionId: string, usage: TokenUsage) => void;

  loadSessions: () => Promise<void>;
  loadConfig: () => Promise<void>;
  createSession: (name: string, group: string, repoUrl: string, branch: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  sendMessage: (sessionId: string, text: string) => Promise<void>;
  cancelAgent: (sessionId: string) => Promise<void>;
  respondPermission: (sessionId: string, requestId: string, allow: boolean) => Promise<void>;
  setMode: (sessionId: string, mode: AgentMode) => Promise<void>;
  updateConfig: (config: AppConfig) => Promise<void>;
  initEventListeners: () => Promise<void>;
}

const defaultConfig: AppConfig = {
  anthropic_api_key: null,
  github_pat: null,
  github_username: null,
  default_mode: 'plan',
  auto_push_on_complete: true,
  notifications_enabled: true,
  workspace_base_path: '',
  max_sessions: 20,
  model: 'claude-sonnet-4-20250514',
};

// --- Mock agent simulation ---
function mockAgentResponse(sessionId: string, text: string, get: () => SessionStore) {
  const add = (entry: OutputEntry) => get().addOutput(sessionId, entry);
  const now = () => new Date().toISOString();

  // Update session to running
  const session = get().sessions.find(s => s.id === sessionId);
  if (session) {
    get().updateSession({ ...session, state: 'running' });
  }

  const steps: { delay: number; fn: () => void }[] = [
    { delay: 300, fn: () => add({ entry_type: 'action', content: 'List: .', timestamp: now(), metadata: { tool_type: 'list_dir' } }) },
    { delay: 600, fn: () => add({ entry_type: 'action', content: 'list_dir: 12 entries', timestamp: now(), metadata: { tool_type: 'list_dir' } }) },
    { delay: 900, fn: () => add({ entry_type: 'message', content: `I see you asked: "${text}"\n\n`, timestamp: now(), metadata: { streaming: true } }) },
    { delay: 1000, fn: () => add({ entry_type: 'message', content: 'Let me explore the workspace ', timestamp: now(), metadata: { streaming: true } }) },
    { delay: 1100, fn: () => add({ entry_type: 'message', content: 'to understand what we have here.\n\n', timestamp: now(), metadata: { streaming: true } }) },
    { delay: 1300, fn: () => add({ entry_type: 'action', content: 'Read: src/main.rs', timestamp: now(), metadata: { tool_type: 'file_read' } }) },
    { delay: 1600, fn: () => add({ entry_type: 'action', content: 'file_read: 245 chars output', timestamp: now(), metadata: { tool_type: 'file_read' } }) },
    { delay: 1900, fn: () => add({ entry_type: 'message', content: 'I found the main entry point. ', timestamp: now(), metadata: { streaming: true } }) },
    { delay: 2100, fn: () => add({ entry_type: 'message', content: 'This is a mock response — connect your Anthropic API key in **Settings** to enable real agent interactions.\n\n', timestamp: now(), metadata: { streaming: true } }) },
    { delay: 2300, fn: () => add({ entry_type: 'message', content: 'In mock mode, you can test the full UI: create sessions, switch between them, try PLAN mode permissions, and explore the layout.', timestamp: now(), metadata: { streaming: true } }) },
    { delay: 2500, fn: () => add({ entry_type: 'system', content: '', timestamp: now(), metadata: { stream_end: true } }) },
    { delay: 2600, fn: () => {
      if (session) {
        get().updateSession({ ...session, state: 'completed' });
        get().updateTokenUsage(sessionId, { input_tokens: 1250, output_tokens: 340, total_cost_usd: 0.0089 });
      }
    }},
  ];

  // If in plan mode, insert a mock permission request
  if (session?.mode === 'plan') {
    steps.splice(3, 0, {
      delay: 800,
      fn: () => {
        if (session) {
          const perm = {
            id: crypto.randomUUID(),
            tool_type: 'bash_exec',
            description: 'List project files',
            command: 'ls -la src/',
            timestamp: now(),
          };
          get().updateSession({
            ...session,
            state: 'waiting_permission',
            pending_permissions: [perm],
          });
        }
      },
    });
  }

  steps.forEach(({ delay, fn }) => setTimeout(fn, delay));
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  outputs: {},
  config: defaultConfig,
  tokenUsage: {},

  setActiveSession: (id) => set({ activeSessionId: id }),

  addOutput: (sessionId, entry) => set((state) => {
    const existing = state.outputs[sessionId] || [];

    // Streaming: append to last message entry
    if (entry.metadata?.streaming && existing.length > 0) {
      const last = existing[existing.length - 1];
      if (last.entry_type === 'message') {
        const updated = [...existing];
        updated[updated.length - 1] = {
          ...last,
          content: last.content + entry.content,
        };
        return { outputs: { ...state.outputs, [sessionId]: updated } };
      }
    }

    // Stream end marker — skip, don't create an entry
    if (entry.metadata?.stream_end) {
      return state;
    }

    // Normal entry — cap at 5000
    const updated = existing.length >= 5000
      ? [...existing.slice(-4999), entry]
      : [...existing, entry];
    return { outputs: { ...state.outputs, [sessionId]: updated } };
  }),

  updateSession: (session) => set((state) => ({
    sessions: state.sessions.map((s) => s.id === session.id ? session : s),
  })),

  updateTokenUsage: (sessionId, usage) => set((state) => ({
    tokenUsage: { ...state.tokenUsage, [sessionId]: usage },
  })),

  loadSessions: async () => {
    const sessions = await api.getSessions();
    if (sessions) set({ sessions });
  },

  loadConfig: async () => {
    const config = await api.getConfig();
    if (config) set({ config });
  },

  createSession: async (name, group, repoUrl, branch) => {
    if (!isTauri()) {
      const mockSession: Session = {
        id: crypto.randomUUID(),
        name,
        group,
        repo_url: repoUrl,
        branch,
        workspace_path: `/workspace/${name}`,
        state: 'idle',
        mode: get().config.default_mode,
        created_at: new Date().toISOString(),
        last_activity: new Date().toISOString(),
        pending_permissions: [],
        git_sync_status: 'never_pushed',
        token_usage: { input_tokens: 0, output_tokens: 0, total_cost_usd: 0 },
        workspace_ready: true,
      };
      set((state) => ({ sessions: [...state.sessions, mockSession], activeSessionId: mockSession.id }));
      return;
    }
    const session = await api.createSession(name, group, repoUrl, branch);
    if (session) {
      set((state) => ({ sessions: [...state.sessions, session], activeSessionId: session.id }));
    }
  },

  deleteSession: async (id) => {
    if (isTauri()) await api.deleteSession(id);
    set((state) => ({
      sessions: state.sessions.filter((s) => s.id !== id),
      activeSessionId: state.activeSessionId === id ? null : state.activeSessionId,
    }));
  },

  sendMessage: async (sessionId, text) => {
    get().addOutput(sessionId, {
      entry_type: 'message',
      content: `**You:** ${text}`,
      timestamp: new Date().toISOString(),
    });

    if (!isTauri()) {
      mockAgentResponse(sessionId, text, get);
      return;
    }
    try {
      await api.sendMessage(sessionId, text);
    } catch (e) {
      get().addOutput(sessionId, {
        entry_type: 'error',
        content: `Error: ${e}`,
        timestamp: new Date().toISOString(),
      });
    }
  },

  cancelAgent: async (sessionId) => {
    if (!isTauri()) {
      // Mock: just set to completed
      const session = get().sessions.find(s => s.id === sessionId);
      if (session) {
        get().updateSession({ ...session, state: 'completed', pending_permissions: [] });
        get().addOutput(sessionId, {
          entry_type: 'system',
          content: 'Agent cancelled.',
          timestamp: new Date().toISOString(),
        });
      }
      return;
    }
    try {
      await api.cancelAgent(sessionId);
    } catch (e) {
      get().addOutput(sessionId, {
        entry_type: 'error',
        content: `Cancel failed: ${e}`,
        timestamp: new Date().toISOString(),
      });
    }
  },

  respondPermission: async (sessionId, requestId, allow) => {
    if (!isTauri()) {
      // Mock: remove permission and resume
      const session = get().sessions.find(s => s.id === sessionId);
      if (session) {
        get().updateSession({
          ...session,
          state: 'running',
          pending_permissions: session.pending_permissions.filter(p => p.id !== requestId),
        });
        if (allow) {
          get().addOutput(sessionId, {
            entry_type: 'action',
            content: 'bash_exec: `ls -la src/`',
            timestamp: new Date().toISOString(),
            metadata: { tool_type: 'bash_exec' },
          });
        } else {
          get().addOutput(sessionId, {
            entry_type: 'system',
            content: 'Denied: bash_exec',
            timestamp: new Date().toISOString(),
          });
        }
        // Continue mock flow
        setTimeout(() => {
          get().updateSession({ ...session, state: 'completed', pending_permissions: [] });
        }, 500);
      }
      return;
    }
    await api.respondPermission(sessionId, requestId, allow);
  },

  setMode: async (sessionId, mode) => {
    set((state) => ({
      sessions: state.sessions.map((s) => s.id === sessionId ? { ...s, mode } : s),
    }));
    if (isTauri()) await api.setMode(sessionId, mode);
  },

  updateConfig: async (config) => {
    set({ config });
    if (isTauri()) await api.updateConfig(config);
  },

  initEventListeners: async () => {
    await events.onSessionOutput((data) => {
      const { session_id, entry } = data as { session_id: string; entry: OutputEntry };
      get().addOutput(session_id, entry);
    });
    await events.onSessionState((data) => {
      const { session } = data as { session_id: string; session: Session };
      get().updateSession(session);
    });
    await events.onPermissionRequest(() => {
      get().loadSessions();
    });
    await events.onTokenUsage((data) => {
      const { session_id, usage } = data as { session_id: string; usage: TokenUsage };
      get().updateTokenUsage(session_id, usage);
    });
  },
}));
