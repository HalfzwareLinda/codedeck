import { create } from 'zustand';
import type { DmConversation, DmMessage, NostrConfig } from '../types';
import * as nostr from '../services/nostrService';
import { npubEncode } from 'nostr-tools/nip19';
import { persistGet, persistSet } from '../services/persistStore';

const DEFAULT_RELAYS = ['wss://relay2.descendant.io', 'wss://relay.primal.net', 'wss://nos.lol'];
const MAX_MESSAGES_PER_CONVERSATION = 500;
const STORAGE_KEY = 'codedeck_dm';

/** Window (seconds) within which same-content messages from the same sender are considered duplicates. */
const CONTENT_DEDUP_WINDOW_S = 60;

interface DmStore {
  conversations: DmConversation[];
  messages: Record<string, DmMessage[]>;
  activeConversationId: string | null;
  nostrConfig: NostrConfig;
  connectionStatus: 'disconnected' | 'connecting' | 'connected';
  profileCache: Record<string, { name: string; fetchedAt: number }>;

  setActiveConversation: (id: string | null) => void;
  addMessage: (msg: DmMessage) => void;
  markConversationRead: (conversationId: string) => void;
  updateNostrConfig: (config: NostrConfig) => void;
  setConnectionStatus: (status: 'disconnected' | 'connecting' | 'connected') => void;

  connect: () => void;
  disconnect: () => void;
  sendDm: (recipientPubkey: string, content: string) => Promise<void>;
  startConversation: (recipientPubkey: string, displayName?: string) => void;
  loadPersisted: () => Promise<void>;
  resolveProfileName: (pubkeyHex: string) => Promise<void>;
  resolveAllProfiles: () => void;
}

interface PersistedDmData {
  conversations: DmConversation[];
  messages: Record<string, DmMessage[]>;
  nostrConfig: NostrConfig;
  profileCache?: Record<string, { name: string; fetchedAt: number }>;
}

function persist(state: { conversations: DmConversation[]; messages: Record<string, DmMessage[]>; nostrConfig: NostrConfig }) {
  const profileCache = useDmStore.getState().profileCache;
  persistSet(STORAGE_KEY, {
    conversations: state.conversations,
    messages: state.messages,
    nostrConfig: state.nostrConfig,
    profileCache,
  });
}

/**
 * Compute the latest message timestamp across all conversations (as unix seconds).
 * Used as `since` filter when subscribing to relays so we don't replay old messages.
 * Subtracts a 30-second grace window to catch events near the boundary.
 */
function getLatestMessageTimestamp(messages: Record<string, DmMessage[]>): number | undefined {
  let latest = 0;
  for (const convMsgs of Object.values(messages)) {
    for (const msg of convMsgs) {
      const ts = Math.floor(new Date(msg.timestamp).getTime() / 1000);
      if (ts > latest) latest = ts;
    }
  }
  // 30-second grace window to catch boundary events
  return latest > 0 ? latest - 30 : undefined;
}

export const useDmStore = create<DmStore>((set, get) => ({
  conversations: [],
  messages: {},
  activeConversationId: null,
  nostrConfig: { private_key_hex: null, relays: DEFAULT_RELAYS },
  connectionStatus: 'disconnected',
  profileCache: {},

  setActiveConversation: (id) => {
    set({ activeConversationId: id });
    if (id) get().markConversationRead(id);
  },

  addMessage: (msg) => {
    let newConvPubkey: string | null = null;

    set((state) => {
      const existing = state.messages[msg.conversation_id] || [];

      // Primary dedup: exact message ID match
      if (existing.some(m => m.id === msg.id)) return state;

      // Fallback dedup: same sender + same content within time window.
      // Catches duplicates from other NIP-17 clients that generate different rumor IDs.
      const msgTs = Math.floor(new Date(msg.timestamp).getTime() / 1000);
      const isDuplicate = existing.some(m =>
        m.sender_pubkey === msg.sender_pubkey &&
        m.content === msg.content &&
        Math.abs(Math.floor(new Date(m.timestamp).getTime() / 1000) - msgTs) < CONTENT_DEDUP_WINDOW_S,
      );
      if (isDuplicate) {
        console.log(`[DM] Content-dedup: skipping duplicate "${msg.content.slice(0, 30)}..."`);
        return state;
      }

      // Cap messages
      const updated = existing.length >= MAX_MESSAGES_PER_CONVERSATION
        ? [...existing.slice(-(MAX_MESSAGES_PER_CONVERSATION - 1)), msg]
        : [...existing, msg];

      const newMessages = { ...state.messages, [msg.conversation_id]: updated };

      // Upsert conversation
      const convIndex = state.conversations.findIndex(c => c.id === msg.conversation_id);
      let newConversations: DmConversation[];

      if (convIndex >= 0) {
        newConversations = state.conversations.map((c, i) =>
          i === convIndex
            ? {
                ...c,
                last_message_at: msg.timestamp,
                unread_count: state.activeConversationId === c.id ? 0 : c.unread_count + 1,
              }
            : c,
        );
      } else {
        // Auto-create conversation from incoming message
        const ownPubkey = state.nostrConfig.private_key_hex
          ? nostr.getPubkeyHex(parseHexToBytes(state.nostrConfig.private_key_hex))
          : '';
        const otherPubkey = msg.sender_pubkey === ownPubkey
          ? msg.conversation_id.split(':').find(p => p !== ownPubkey) || msg.sender_pubkey
          : msg.sender_pubkey;

        newConvPubkey = otherPubkey;

        newConversations = [...state.conversations, {
          id: msg.conversation_id,
          participants: [ownPubkey, otherPubkey].filter(Boolean),
          display_name: truncatePubkey(otherPubkey),
          last_message_at: msg.timestamp,
          unread_count: state.activeConversationId === msg.conversation_id ? 0 : 1,
        }];
      }

      const newState = { conversations: newConversations, messages: newMessages };
      persist({ ...newState, nostrConfig: state.nostrConfig });
      return newState;
    });

    // Resolve profile name for newly auto-created conversation
    if (newConvPubkey) {
      get().resolveProfileName(newConvPubkey);
    }
  },

  markConversationRead: (conversationId) => set((state) => {
    const newConversations = state.conversations.map(c =>
      c.id === conversationId ? { ...c, unread_count: 0 } : c,
    );
    persist({ conversations: newConversations, messages: state.messages, nostrConfig: state.nostrConfig });
    return { conversations: newConversations };
  }),

  updateNostrConfig: (config) => {
    const prev = get().nostrConfig;
    set({ nostrConfig: config });
    persist({ conversations: get().conversations, messages: get().messages, nostrConfig: config });

    // Reconnect if key or relays changed
    if (prev.private_key_hex !== config.private_key_hex || JSON.stringify(prev.relays) !== JSON.stringify(config.relays)) {
      get().disconnect();
      if (config.private_key_hex) {
        get().connect();
      }
    }
  },

  setConnectionStatus: (status) => set({ connectionStatus: status }),

  connect: () => {
    const { nostrConfig, messages } = get();
    if (!nostrConfig.private_key_hex) return;

    nostr.setHandlers(
      (msg) => get().addMessage(msg),
      (status) => get().setConnectionStatus(status),
    );

    const sinceTimestamp = getLatestMessageTimestamp(messages);
    console.log(`[DM] Connecting — relays: ${nostrConfig.relays.join(', ')}, sinceTimestamp: ${sinceTimestamp ?? 'none'} (${sinceTimestamp ? new Date(sinceTimestamp * 1000).toISOString() : 'fetching all'})`);
    nostr.connect(nostrConfig.private_key_hex, nostrConfig.relays, sinceTimestamp);
  },

  disconnect: () => {
    nostr.disconnect();
    set({ connectionStatus: 'disconnected' });
  },

  sendDm: async (recipientPubkey, content) => {
    const { nostrConfig } = get();
    if (!nostrConfig.private_key_hex) return;

    const sk = nostrConfig.private_key_hex;
    try {
      const msg = await nostr.sendDirectMessage(sk, recipientPubkey, content, nostrConfig.relays);
      get().addMessage(msg);
    } catch (e) {
      console.error('Failed to send DM:', e);
      // Show failed message in UI so user sees the failure
      const ownPubkey = nostr.getPubkeyHex(parseHexToBytes(sk));
      const failedMsg: DmMessage = {
        id: crypto.randomUUID(),
        conversation_id: nostr.conversationId(ownPubkey, recipientPubkey),
        sender_pubkey: ownPubkey,
        content,
        timestamp: new Date().toISOString(),
        status: 'failed',
      };
      get().addMessage(failedMsg);
    }
  },

  startConversation: (recipientPubkey, displayName) => {
    const { nostrConfig } = get();
    const ownPubkey = nostrConfig.private_key_hex
      ? nostr.getPubkeyHex(parseHexToBytes(nostrConfig.private_key_hex))
      : '0'.repeat(64);

    const convId = nostr.conversationId(ownPubkey, recipientPubkey);

    // Don't create if already exists
    if (get().conversations.some(c => c.id === convId)) {
      set({ activeConversationId: convId });
      return;
    }

    const conv: DmConversation = {
      id: convId,
      participants: [ownPubkey, recipientPubkey],
      display_name: displayName || truncatePubkey(recipientPubkey),
      last_message_at: new Date().toISOString(),
      unread_count: 0,
    };

    set((state) => ({
      conversations: [...state.conversations, conv],
      activeConversationId: convId,
      messages: state.messages[convId] ? state.messages : { ...state.messages, [convId]: [] },
    }));
    persist({ conversations: get().conversations, messages: get().messages, nostrConfig: get().nostrConfig });
    get().resolveProfileName(recipientPubkey);
  },

  loadPersisted: async () => {
    try {
      const data = await persistGet<PersistedDmData>(STORAGE_KEY);
      if (!data) return;

      // Clean up legacy mock conversations (Agent Alpha/Beta placeholders)
      const mockPubkeys = new Set(['0'.repeat(64), 'a'.repeat(64), 'b'.repeat(64)]);
      const conversations = (data.conversations || []).filter(
        c => !c.participants.every(p => mockPubkeys.has(p)),
      );

      set({
        conversations,
        messages: data.messages || {},
        nostrConfig: data.nostrConfig || { private_key_hex: null, relays: DEFAULT_RELAYS },
        profileCache: data.profileCache || {},
      });
    } catch { /* corrupt data — start fresh */ }
  },

  resolveProfileName: async (pubkeyHex) => {
    const { profileCache, nostrConfig } = get();

    // Skip if already cached and fresh (< 24 hours)
    const cached = profileCache[pubkeyHex];
    const CACHE_TTL = 24 * 60 * 60 * 1000;
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
      updateConversationNames(pubkeyHex, cached.name, get, set);
      return;
    }

    const name = await nostr.fetchProfileName(pubkeyHex, nostrConfig.relays);
    if (!name) return;

    set((state) => ({
      profileCache: { ...state.profileCache, [pubkeyHex]: { name, fetchedAt: Date.now() } },
    }));

    updateConversationNames(pubkeyHex, name, get, set);
  },

  resolveAllProfiles: () => {
    const { conversations, nostrConfig } = get();
    if (!nostrConfig.private_key_hex) return;
    const ownPubkey = nostr.getPubkeyHex(parseHexToBytes(nostrConfig.private_key_hex));
    for (const conv of conversations) {
      const other = conv.participants.find(p => p !== ownPubkey);
      if (other) get().resolveProfileName(other);
    }
  },
}));

// --- Helpers ---

function updateConversationNames(
  pubkeyHex: string,
  name: string,
  get: () => DmStore,
  set: (partial: Partial<DmStore> | ((s: DmStore) => Partial<DmStore>)) => void,
) {
  const { conversations, messages, nostrConfig } = get();
  const ownPubkey = nostrConfig.private_key_hex
    ? nostr.getPubkeyHex(parseHexToBytes(nostrConfig.private_key_hex))
    : '';

  let changed = false;
  const updated = conversations.map((c) => {
    const otherPubkey = c.participants.find((p) => p !== ownPubkey);
    if (otherPubkey === pubkeyHex && c.display_name !== name) {
      changed = true;
      return { ...c, display_name: name };
    }
    return c;
  });

  if (changed) {
    set({ conversations: updated });
    persist({ conversations: updated, messages, nostrConfig });
  }
}

function truncatePubkey(pubkey: string): string {
  if (pubkey.length < 16) return pubkey;
  // Convert hex pubkey to npub for display
  if (/^[0-9a-f]{64}$/i.test(pubkey)) {
    try {
      const npub = npubEncode(pubkey);
      return npub.slice(0, 10) + '...' + npub.slice(-4);
    } catch { /* fall through to raw truncation */ }
  }
  return pubkey.slice(0, 8) + '...' + pubkey.slice(-4);
}

function parseHexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}
