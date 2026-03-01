import { getPublicKey } from 'nostr-tools/pure';
import { SimplePool } from 'nostr-tools/pool';
import * as nip19 from 'nostr-tools/nip19';
import { wrapEvent, unwrapEvent } from 'nostr-tools/nip59';
import type { DmMessage } from '../types';

let pool: SimplePool | null = null;
let subscription: ReturnType<SimplePool['subscribeMany']> | null = null;
let ownPubkey: string | null = null;

type MessageHandler = (msg: DmMessage) => void;
let onMessage: MessageHandler | null = null;

type StatusHandler = (status: 'disconnected' | 'connecting' | 'connected') => void;
let onStatus: StatusHandler | null = null;

/** Convert nsec bech32 or 64-char hex to Uint8Array. Returns null on invalid input. */
export function parsePrivateKey(input: string): Uint8Array | null {
  const trimmed = input.trim();

  // nsec bech32
  if (trimmed.startsWith('nsec1')) {
    try {
      const decoded = nip19.decode(trimmed);
      if (decoded.type === 'nsec') return decoded.data as Uint8Array;
    } catch {
      return null;
    }
    return null;
  }

  // 64-char hex
  if (/^[0-9a-f]{64}$/i.test(trimmed)) {
    return hexToBytes(trimmed);
  }

  return null;
}

/** Convert npub bech32 or 64-char hex to hex pubkey string. Returns null on invalid input. */
export function parsePublicKey(input: string): string | null {
  const trimmed = input.trim();

  // npub bech32
  if (trimmed.startsWith('npub1')) {
    try {
      const decoded = nip19.decode(trimmed);
      if (decoded.type === 'npub') return decoded.data as string;
    } catch { /* invalid bech32 */ }
    return null;
  }

  // 64-char hex
  if (/^[0-9a-f]{64}$/i.test(trimmed)) {
    return trimmed.toLowerCase();
  }

  return null;
}

/** Derive hex public key from secret key bytes. */
export function getPubkeyHex(sk: Uint8Array): string {
  return getPublicKey(sk);
}

/** Compute deterministic conversation ID from two hex pubkeys. */
export function conversationId(pubkeyA: string, pubkeyB: string): string {
  return [pubkeyA, pubkeyB].sort().join(':');
}

/** Register callbacks for incoming messages and connection status changes. */
export function setHandlers(msgHandler: MessageHandler, statusHandler: StatusHandler): void {
  onMessage = msgHandler;
  onStatus = statusHandler;
}

/** Connect to relays and subscribe to incoming gift wraps (kind 1059). */
export function connect(privateKeyHex: string, relays: string[]): void {
  disconnect();

  const sk = hexToBytes(privateKeyHex);
  ownPubkey = getPublicKey(sk);

  onStatus?.('connecting');

  pool = new SimplePool();

  subscription = pool.subscribeMany(
    relays,
    { kinds: [1059], '#p': [ownPubkey] },
    {
      onevent(event) {
        const msg = processGiftWrap(event, sk);
        if (msg) onMessage?.(msg);
      },
      oneose() {
        onStatus?.('connected');
      },
    },
  );
}

/** Close relay connections. */
export function disconnect(): void {
  if (subscription) {
    subscription.close();
    subscription = null;
  }
  if (pool) {
    pool.destroy();
    pool = null;
  }
  ownPubkey = null;
  onStatus?.('disconnected');
}

/**
 * Send a NIP-17 DM.
 *
 * 1. Build kind 14 rumor template
 * 2. wrapEvent() for recipient (seal + gift wrap)
 * 3. wrapEvent() for self (so we can see our own sent messages)
 * 4. Publish both via pool
 */
export async function sendDirectMessage(
  senderSkHex: string,
  recipientPubkey: string,
  content: string,
  relays: string[],
): Promise<DmMessage> {
  if (!pool) {
    pool = new SimplePool();
  }

  const senderSk = hexToBytes(senderSkHex);
  const senderPubkey = getPublicKey(senderSk);

  const rumorTemplate = {
    kind: 14,
    content,
    tags: [['p', recipientPubkey]],
  };

  // Wrap for recipient
  const wrapForRecipient = wrapEvent(rumorTemplate, senderSk, recipientPubkey);

  // Wrap for self (so sender sees their own message)
  const wrapForSelf = wrapEvent(rumorTemplate, senderSk, senderPubkey);

  // Publish both
  await Promise.all([
    pool.publish(relays, wrapForRecipient),
    pool.publish(relays, wrapForSelf),
  ]);

  const convId = conversationId(senderPubkey, recipientPubkey);

  return {
    id: wrapForRecipient.id,
    conversation_id: convId,
    sender_pubkey: senderPubkey,
    content,
    timestamp: new Date().toISOString(),
    status: 'sent',
  };
}

/** Decrypt a kind 1059 gift wrap event and extract the DM message. */
function processGiftWrap(event: Parameters<typeof unwrapEvent>[0], recipientSk: Uint8Array): DmMessage | null {
  try {
    const rumor = unwrapEvent(event, recipientSk);

    if (rumor.kind !== 14) return null;

    const senderPubkey = rumor.pubkey;
    const recipientPubkey = getPublicKey(recipientSk);

    // Find the other participant from p-tags or sender
    const pTags = (rumor.tags || []).filter((t: string[]) => t[0] === 'p').map((t: string[]) => t[1]);
    const otherPubkey = senderPubkey === recipientPubkey
      ? pTags[0] || senderPubkey
      : senderPubkey;

    const convId = conversationId(recipientPubkey, otherPubkey);

    return {
      id: rumor.id || event.id,
      conversation_id: convId,
      sender_pubkey: senderPubkey,
      content: rumor.content,
      timestamp: new Date((rumor.created_at || 0) * 1000).toISOString(),
      status: 'delivered',
    };
  } catch (err) {
    console.warn('[Nostr] Failed to process gift wrap event:', err);
    return null;
  }
}

// --- Helpers ---

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}
