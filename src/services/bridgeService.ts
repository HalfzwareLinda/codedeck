/**
 * Bridge Service — connects Codedeck to remote Claude Code sessions via Nostr.
 *
 * Subscribes to output events from a paired bridge (VSCode extension) and
 * publishes input events back. All communication is NIP-44 encrypted.
 *
 * Protocol:
 * - Session list: NIP-33 replaceable events (kind 30515, d-tag = machine name)
 * - Output: Regular events (kind 29515) with seq counter per session
 * - History: Request/response pattern for catch-up on connect
 */

import { SimplePool } from 'nostr-tools/pool';
import { getPublicKey } from 'nostr-tools/pure';
import { encrypt, decrypt, getConversationKey } from 'nostr-tools/nip44';
import { finalizeEvent } from 'nostr-tools/pure';
import type {
  AgentMode,
  RemoteMachine,
  RemoteSessionInfo,
  RemoteOutputEntry,
  BridgeInboundMessage,
  BridgeOutboundMessage,
} from '../types';
import { chunkBase64 } from '../utils/imageUtils';

// Must match the bridge extension's event kinds.
// Kind 4515 is in the regular range (1-9999) so relays store and forward reliably.
// Previously 29515 which is ephemeral (20000-29999) — relays dropped these events.
const OUTPUT_EVENT_KIND = 4515;
const SESSION_LIST_EVENT_KIND = 30515;

type SessionListHandler = (machine: string, sessions: RemoteSessionInfo[]) => void;
type OutputHandler = (sessionId: string, entry: RemoteOutputEntry, seq: number) => void;
type HistoryHandler = (sessionId: string, entries: Array<{ seq: number; entry: RemoteOutputEntry }>, totalEntries: number, chunkIndex?: number, totalChunks?: number, requestId?: string) => void;
type StatusHandler = (machine: string, status: 'connected' | 'disconnected' | 'connecting') => void;
type SessionPendingHandler = (pendingId: string, machine: string, createdAt: string) => void;
type SessionReadyHandler = (pendingId: string, session: RemoteSessionInfo) => void;
type SessionFailedHandler = (pendingId: string, reason: string) => void;

let pool: SimplePool | null = null;
const subscriptions: Map<string, ReturnType<SimplePool['subscribeMany']>> = new Map();

let onSessionList: SessionListHandler | null = null;
let onOutput: OutputHandler | null = null;
let onHistory: HistoryHandler | null = null;
let onStatus: StatusHandler | null = null;
let onSessionPending: SessionPendingHandler | null = null;
let onSessionReady: SessionReadyHandler | null = null;
let onSessionFailed: SessionFailedHandler | null = null;

let ownSecretKeyBytes: Uint8Array | null = null;
let ownPubkeyHex: string | null = null;

/**
 * Initialize the bridge service with the phone's Nostr identity.
 */
export function initBridge(privateKeyHex: string): void {
  const newKeyBytes = hexToBytes(privateKeyHex);
  const newPubkey = getPublicKey(newKeyBytes);

  // If re-initializing with a different key, tear down old subscriptions
  if (ownPubkeyHex && ownPubkeyHex !== newPubkey) {
    disconnectAll();
  }

  ownSecretKeyBytes = newKeyBytes;
  ownPubkeyHex = newPubkey;

  if (!pool) {
    pool = new SimplePool();
  }
}

/**
 * Register event handlers.
 */
export function setBridgeHandlers(
  sessionListHandler: SessionListHandler,
  outputHandler: OutputHandler,
  statusHandler: StatusHandler,
  historyHandler?: HistoryHandler,
  sessionPendingHandler?: SessionPendingHandler,
  sessionReadyHandler?: SessionReadyHandler,
  sessionFailedHandler?: SessionFailedHandler,
): void {
  onSessionList = sessionListHandler;
  onOutput = outputHandler;
  onStatus = statusHandler;
  onHistory = historyHandler ?? null;
  onSessionPending = sessionPendingHandler ?? null;
  onSessionReady = sessionReadyHandler ?? null;
  onSessionFailed = sessionFailedHandler ?? null;
}

/**
 * Connect to a remote machine's bridge via Nostr relays.
 */
export function connectToMachine(machine: RemoteMachine): void {
  if (!pool || !ownSecretKeyBytes || !ownPubkeyHex) {
    console.error('[Bridge] Not initialized. Call initBridge() first.');
    return;
  }

  // Disconnect existing subscription for this machine
  disconnectFromMachine(machine.pubkeyHex);

  onStatus?.(machine.hostname, 'connecting');

  const sub = pool.subscribeMany(
    machine.relays,
    // Subscribe to both output events (kind 29515) and session list (kind 30515)
    { kinds: [OUTPUT_EVENT_KIND, SESSION_LIST_EVENT_KIND], '#p': [ownPubkeyHex], authors: [machine.pubkeyHex] },
    {
      onevent(event) {
        handleBridgeEvent(event, machine);
      },
      oneose() {
        onStatus?.(machine.hostname, 'connected');
      },
    },
  );

  subscriptions.set(machine.pubkeyHex, sub);
}

/**
 * Disconnect from a specific machine.
 */
export function disconnectFromMachine(pubkeyHex: string): void {
  const sub = subscriptions.get(pubkeyHex);
  if (sub) {
    sub.close();
    subscriptions.delete(pubkeyHex);
  }
}

/**
 * Disconnect from all machines.
 */
export function disconnectAll(): void {
  for (const [key, sub] of subscriptions) {
    sub.close();
    subscriptions.delete(key);
  }
  if (pool) {
    pool.destroy();
    pool = null;
  }
}

/**
 * Send a message to a Claude Code session on a remote machine.
 */
export async function sendRemoteInput(
  machine: RemoteMachine,
  sessionId: string,
  text: string,
): Promise<void> {
  const msg: BridgeOutboundMessage = { type: 'input', sessionId, text };
  await publishToMachine(machine, msg);
}

/**
 * Send a permission response to a remote machine.
 */
export async function sendRemotePermissionResponse(
  machine: RemoteMachine,
  sessionId: string,
  requestId: string,
  allow: boolean,
  modifier?: 'always' | 'never',
): Promise<void> {
  const msg: BridgeOutboundMessage = { type: 'permission-res', sessionId, requestId, allow, modifier };
  await publishToMachine(machine, msg);
}

/**
 * Send a mode change to a remote machine.
 */
export async function sendRemoteModeChange(
  machine: RemoteMachine,
  sessionId: string,
  mode: AgentMode,
): Promise<void> {
  const msg: BridgeOutboundMessage = { type: 'mode', sessionId, mode };
  await publishToMachine(machine, msg);
}

/**
 * Request a new Claude Code terminal session on a remote machine.
 * The bridge will open a Claude Code terminal in the VSCode workspace.
 */
export async function sendCreateSessionRequest(
  machine: RemoteMachine,
): Promise<void> {
  const msg: BridgeOutboundMessage = { type: 'create-session' };
  await publishToMachine(machine, msg);
}

/**
 * Request the bridge to re-scan and re-publish its session list.
 */
export async function sendRefreshRequest(
  machine: RemoteMachine,
): Promise<void> {
  const msg: BridgeOutboundMessage = { type: 'refresh-sessions' };
  await publishToMachine(machine, msg);
}

/**
 * Request history for a session from a remote machine.
 * The bridge will respond with a history message containing past entries.
 */
export async function sendHistoryRequest(
  machine: RemoteMachine,
  sessionId: string,
  afterSeq?: number,
): Promise<void> {
  const msg: BridgeOutboundMessage = { type: 'history-request', sessionId, afterSeq };
  await publishToMachine(machine, msg);
}

/**
 * Send an image attachment to a Claude Code session on a remote machine.
 * The image is chunked into relay-safe pieces and sent as sequential events.
 */
export async function sendRemoteImage(
  machine: RemoteMachine,
  sessionId: string,
  text: string,
  base64: string,
  filename: string,
  mimeType: string,
): Promise<void> {
  const uploadId = crypto.randomUUID();
  const chunks = chunkBase64(base64);

  for (let i = 0; i < chunks.length; i++) {
    const msg: BridgeOutboundMessage = {
      type: 'upload-image',
      sessionId,
      uploadId,
      filename,
      mimeType,
      base64Data: chunks[i],
      text: i === 0 ? text : '',
      chunkIndex: i,
      totalChunks: chunks.length,
    };
    await publishToMachine(machine, msg);

    // Inter-chunk delay to avoid relay rate-limiting
    if (i < chunks.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }
}

// --- Internal ---

async function publishToMachine(machine: RemoteMachine, msg: BridgeOutboundMessage): Promise<void> {
  if (!pool || !ownSecretKeyBytes) {
    console.error('[Bridge] Not initialized');
    return;
  }

  try {
    const json = JSON.stringify(msg);
    const conversationKey = getConversationKey(ownSecretKeyBytes, machine.pubkeyHex);
    const ciphertext = encrypt(json, conversationKey);

    const event = finalizeEvent({
      kind: OUTPUT_EVENT_KIND, // phone→bridge messages use regular event kind
      created_at: Math.floor(Date.now() / 1000),
      tags: [['p', machine.pubkeyHex]],
      content: ciphertext,
    }, ownSecretKeyBytes);

    // pool.publish returns Promise<string>[] — await each relay individually
    const results = pool.publish(machine.relays, event);
    const outcomes = await Promise.allSettled(results);
    for (let i = 0; i < outcomes.length; i++) {
      if (outcomes[i].status === 'rejected') {
        console.warn(`[Bridge] Relay ${machine.relays[i]} rejected publish:`, (outcomes[i] as PromiseRejectedResult).reason);
      }
    }
  } catch (err) {
    console.error(`[Bridge] Failed to publish to ${machine.hostname}:`, err);
  }
}

function handleBridgeEvent(event: { pubkey: string; content: string }, _machine: RemoteMachine): void {
  if (!ownSecretKeyBytes) { return; }

  try {
    const conversationKey = getConversationKey(ownSecretKeyBytes, event.pubkey);
    const plaintext = decrypt(event.content, conversationKey);
    const msg: BridgeInboundMessage = JSON.parse(plaintext);

    switch (msg.type) {
      case 'sessions':
        onSessionList?.(msg.machine, msg.sessions);
        break;
      case 'output':
        onOutput?.(msg.sessionId, msg.entry, msg.seq);
        break;
      case 'history':
        onHistory?.(msg.sessionId, msg.entries, msg.totalEntries, msg.chunkIndex, msg.totalChunks, msg.requestId);
        break;
      case 'session-pending':
        onSessionPending?.(msg.pendingId, msg.machine, msg.createdAt);
        break;
      case 'session-ready':
        onSessionReady?.(msg.pendingId, msg.session);
        break;
      case 'session-failed':
        onSessionFailed?.(msg.pendingId, msg.reason);
        break;
    }
  } catch (err) {
    console.error('[Bridge] Failed to decrypt/parse event:', err);
    onStatus?.(_machine.hostname, 'disconnected');
  }
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}
