import { create } from 'zustand';
import { Session, OutputEntry, AppConfig, AgentMode } from '../types';

// Tauri API imports - lazy loaded to allow running in browser for testing
type InvokeFn = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
type ListenFn = (event: string, handler: (event: { payload: unknown }) => void) => Promise<() => void>;

let _invoke: InvokeFn | null = null;
let _listen: ListenFn | null = null;
let _tauriInitialized = false;

async function initTauri(): Promise<void> {
  if (_tauriInitialized) return;
  _tauriInitialized = true;
  try {
    const tauriCore = await import('@tauri-apps/api/core');
    _invoke = tauriCore.invoke as InvokeFn;
    const tauriEvent = await import('@tauri-apps/api/event');
    _listen = tauriEvent.listen as ListenFn;
  } catch {
    console.log('Running outside Tauri - using mock mode');
  }
}

interface SessionStore {
  sessions: Session[];
  activeSessionId: string | null;
  outputs: Record<string, OutputEntry[]>;
  config: AppConfig | null;
  sidebarOpen: boolean;
  settingsOpen: boolean;
  newSessionOpen: boolean;

  setActiveSession: (id: string) => void;
  setSidebarOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setNewSessionOpen: (open: boolean) => void;
  addOutput: (sessionId: string, entry: OutputEntry) => void;
  updateSession: (session: Session) => void;

  loadSessions: () => Promise<void>;
  loadConfig: () => Promise<void>;
  createSession: (name: string, group: string, repoUrl: string, branch: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  sendMessage: (sessionId: string, text: string) => Promise<void>;
  respondPermission: (sessionId: string, requestId: string, allow: boolean) => Promise<void>;
  setMode: (sessionId: string, mode: AgentMode) => Promise<void>;
  gitPush: (sessionId: string) => Promise<void>;
  gitPull: (sessionId: string) => Promise<void>;
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

export const useSessionStore = create<SessionStore>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  outputs: {},
  config: defaultConfig,
  sidebarOpen: true,
  settingsOpen: false,
  newSessionOpen: false,

  setActiveSession: (id) => set({ activeSessionId: id }),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  setNewSessionOpen: (open) => set({ newSessionOpen: open }),

  addOutput: (sessionId, entry) => set((state) => ({
    outputs: {
      ...state.outputs,
      [sessionId]: [...(state.outputs[sessionId] || []), entry],
    },
  })),

  updateSession: (session) => set((state) => ({
    sessions: state.sessions.map((s) => s.id === session.id ? session : s),
  })),

  loadSessions: async () => {
    await initTauri();
    if (!_invoke) return;
    try {
      const sessions = await _invoke('get_sessions') as Session[];
      set({ sessions });
    } catch (e) {
      console.error('Failed to load sessions:', e);
    }
  },

  loadConfig: async () => {
    await initTauri();
    if (!_invoke) return;
    try {
      const config = await _invoke('get_config') as AppConfig;
      set({ config });
    } catch (e) {
      console.error('Failed to load config:', e);
    }
  },

  createSession: async (name, group, repoUrl, branch) => {
    await initTauri();
    if (!_invoke) {
      const mockSession: Session = {
        id: crypto.randomUUID(),
        name,
        group,
        repo_url: repoUrl,
        branch,
        workspace_path: `/workspace/${name}`,
        state: 'idle',
        mode: 'plan',
        created_at: new Date().toISOString(),
        last_activity: new Date().toISOString(),
        pending_permissions: [],
        git_sync_status: 'never_pushed',
      };
      set((state) => ({ sessions: [...state.sessions, mockSession], activeSessionId: mockSession.id }));
      return;
    }
    try {
      const session = await _invoke('create_session', { name, group, repoUrl, branch }) as Session;
      set((state) => ({ sessions: [...state.sessions, session], activeSessionId: session.id }));
    } catch (e) {
      console.error('Failed to create session:', e);
    }
  },

  deleteSession: async (id) => {
    await initTauri();
    if (!_invoke) {
      set((state) => ({
        sessions: state.sessions.filter((s) => s.id !== id),
        activeSessionId: state.activeSessionId === id ? null : state.activeSessionId,
      }));
      return;
    }
    try {
      await _invoke('delete_session', { sessionId: id });
      set((state) => ({
        sessions: state.sessions.filter((s) => s.id !== id),
        activeSessionId: state.activeSessionId === id ? null : state.activeSessionId,
      }));
    } catch (e) {
      console.error('Failed to delete session:', e);
    }
  },

  sendMessage: async (sessionId, text) => {
    get().addOutput(sessionId, {
      entry_type: 'message',
      content: `**You:** ${text}`,
      timestamp: new Date().toISOString(),
    });

    await initTauri();
    if (!_invoke) {
      setTimeout(() => {
        get().addOutput(sessionId, {
          entry_type: 'message',
          content: 'I received your message. This is a mock response — connect the Anthropic API key in settings to enable real agent interactions.',
          timestamp: new Date().toISOString(),
        });
      }, 500);
      return;
    }
    try {
      await _invoke('send_message', { sessionId, text });
    } catch (e) {
      console.error('Failed to send message:', e);
      get().addOutput(sessionId, {
        entry_type: 'error',
        content: `Error: ${e}`,
        timestamp: new Date().toISOString(),
      });
    }
  },

  respondPermission: async (sessionId, requestId, allow) => {
    await initTauri();
    if (!_invoke) return;
    try {
      await _invoke('respond_permission', { sessionId, requestId, allow });
    } catch (e) {
      console.error('Failed to respond to permission:', e);
    }
  },

  setMode: async (sessionId, mode) => {
    set((state) => ({
      sessions: state.sessions.map((s) => s.id === sessionId ? { ...s, mode } : s),
    }));
    await initTauri();
    if (!_invoke) return;
    try {
      await _invoke('set_mode', { sessionId, mode });
    } catch (e) {
      console.error('Failed to set mode:', e);
    }
  },

  gitPush: async (sessionId) => {
    await initTauri();
    if (!_invoke) return;
    try {
      await _invoke('git_push', { sessionId });
    } catch (e) {
      console.error('Failed to push:', e);
    }
  },

  gitPull: async (sessionId) => {
    await initTauri();
    if (!_invoke) return;
    try {
      await _invoke('git_pull', { sessionId });
    } catch (e) {
      console.error('Failed to pull:', e);
    }
  },

  updateConfig: async (config) => {
    set({ config });
    await initTauri();
    if (!_invoke) return;
    try {
      await _invoke('update_config', { config });
    } catch (e) {
      console.error('Failed to update config:', e);
    }
  },

  initEventListeners: async () => {
    await initTauri();
    if (!_listen) return;

    await _listen('session-output', (event) => {
      const payload = event.payload as { session_id: string; entry: OutputEntry };
      get().addOutput(payload.session_id, payload.entry);
    });

    await _listen('session-state', (event) => {
      const payload = event.payload as { session_id: string; state: string; session: Session };
      get().updateSession(payload.session);
    });

    await _listen('permission-request', () => {
      get().loadSessions();
    });
  },
}));
