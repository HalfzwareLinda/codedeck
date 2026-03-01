import { create } from 'zustand';
import type { DmConversation, DmMessage, NostrConfig } from '../types';
import * as nostr from '../services/nostrService';
import { npubEncode } from 'nostr-tools/nip19';
import { persistGet, persistSet } from '../services/persistStore';

const DEFAULT_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol'];
const MAX_MESSAGES_PER_CONVERSATION = 500;
const STORAGE_KEY = 'codedeck_dm';

interface DmStore {
  conversations: DmConversation[];
  messages: Record<string, DmMessage[]>;
  activeConversationId: string | null;
  nostrConfig: NostrConfig;
  connectionStatus: 'disconnected' | 'connecting' | 'connected';

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
}

interface PersistedDmData {
  conversations: DmConversation[];
  messages: Record<string, DmMessage[]>;
  nostrConfig: NostrConfig;
}

function persist(state: { conversations: DmConversation[]; messages: Record<string, DmMessage[]>; nostrConfig: NostrConfig }) {
  persistSet(STORAGE_KEY, {
    conversations: state.conversations,
    messages: state.messages,
    nostrConfig: state.nostrConfig,
  });
}

export const useDmStore = create<DmStore>((set, get) => ({
  conversations: [],
  messages: {},
  activeConversationId: null,
  nostrConfig: { private_key_hex: null, relays: DEFAULT_RELAYS },
  connectionStatus: 'disconnected',

  setActiveConversation: (id) => {
    set({ activeConversationId: id });
    if (id) get().markConversationRead(id);
  },

  addMessage: (msg) => set((state) => {
    // Deduplicate by message id
    const existing = state.messages[msg.conversation_id] || [];
    if (existing.some(m => m.id === msg.id)) return state;

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
  }),

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
    const { nostrConfig } = get();
    if (!nostrConfig.private_key_hex) return;

    nostr.setHandlers(
      (msg) => get().addMessage(msg),
      (status) => get().setConnectionStatus(status),
    );

    nostr.connect(nostrConfig.private_key_hex, nostrConfig.relays);
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
    }));
    persist({ conversations: get().conversations, messages: get().messages, nostrConfig: get().nostrConfig });
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
      });
    } catch { /* corrupt data — start fresh */ }
  },
}));

// --- Helpers ---

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
