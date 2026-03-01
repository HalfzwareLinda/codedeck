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
  token_usage: TokenUsage;
  workspace_ready: boolean;
}

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  total_cost_usd: number;
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

// --- Nostr / DM Types ---

export type PanelMode = 'session' | 'dm';

export interface NostrConfig {
  private_key_hex: string | null;
  relays: string[];
}

export interface DmConversation {
  id: string;
  participants: string[];
  display_name: string;
  last_message_at: string;
  unread_count: number;
}

export interface DmMessage {
  id: string;
  conversation_id: string;
  sender_pubkey: string;
  content: string;
  timestamp: string;
  status: 'sent' | 'delivered' | 'failed';
}

// --- Remote Bridge Types ---

export interface RemoteMachine {
  hostname: string;
  npub: string;
  pubkeyHex: string;
  relays: string[];
  connected: boolean;
}

export interface RemoteSessionInfo {
  id: string;
  slug: string;
  cwd: string;
  lastActivity: string;
  lineCount: number;
}

export interface RemoteOutputEntry {
  entryType: 'text' | 'tool_use' | 'tool_result' | 'system' | 'error' | 'progress';
  content: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export type BridgeInboundMessage =
  | { type: 'sessions'; machine: string; sessions: RemoteSessionInfo[] }
  | { type: 'output'; sessionId: string; seq: number; entry: RemoteOutputEntry }
  | { type: 'history'; sessionId: string; entries: Array<{ seq: number; entry: RemoteOutputEntry }>; totalEntries: number; fromSeq: number; toSeq: number };

export type BridgeOutboundMessage =
  | { type: 'input'; sessionId: string; text: string }
  | { type: 'permission-res'; sessionId: string; requestId: string; allow: boolean }
  | { type: 'mode'; sessionId: string; mode: AgentMode }
  | { type: 'history-request'; sessionId: string; afterSeq?: number };
