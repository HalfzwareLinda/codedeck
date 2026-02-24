export type SessionState = 'idle' | 'running' | 'waiting_permission' | 'completed' | 'error';
export type AgentMode = 'plan' | 'auto';
export type OutputType = 'action' | 'diff' | 'message' | 'error' | 'system';
export type GitSyncStatus = 'synced' | 'pending_push' | 'push_failed' | 'never_pushed';

export interface Session {
  id: string;
  name: string;
  group: string;
  repo_url: string;
  branch: string;
  workspace_path: string;
  state: SessionState;
  mode: AgentMode;
  created_at: string;
  last_activity: string;
  pending_permissions: PermissionRequest[];
  git_sync_status: GitSyncStatus;
}

export interface PermissionRequest {
  id: string;
  tool_type: string;
  description: string;
  command: string;
  timestamp: string;
}

export interface OutputEntry {
  entry_type: OutputType;
  content: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export interface AppConfig {
  anthropic_api_key: string | null;
  github_pat: string | null;
  github_username: string | null;
  default_mode: AgentMode;
  auto_push_on_complete: boolean;
  notifications_enabled: boolean;
  workspace_base_path: string;
  max_sessions: number;
  model: string;
}
