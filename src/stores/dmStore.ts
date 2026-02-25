import { create } from 'zustand';
import type { DmConversation, DmMessage, NostrConfig } from '../types';
import * as nostr from '../services/nostrService';

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
  loadPersisted: () => void;
}

function persist(state: { conversations: DmConversation[]; messages: Record<string, DmMessage[]>; nostrConfig: NostrConfig }) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      conversations: state.conversations,
      messages: state.messages,
      nostrConfig: state.nostrConfig,
    }));
  } catch { /* localStorage full — ignore */ }
}

// --- Mock helpers ---

const MOCK_AGENTS = [
  { pubkey: 'a'.repeat(64), name: 'Agent Alpha' },
  { pubkey: 'b'.repeat(64), name: 'Agent Beta' },
];

const MOCK_REPLIES = [
  'Got it, working on that now.',
  'Task completed successfully.',
  'I need a bit more context — could you clarify?',
  'Running the tests now, will report back shortly.',
  'Done! The changes have been pushed.',
];

function mockReply(conversationId: string, get: () => DmStore) {
  const delay = 1000 + Math.random() * 2000;
  setTimeout(() => {
    const conv = get().conversations.find(c => c.id === conversationId);
    if (!conv) return;
    const agentPubkey = conv.participants.find(p => MOCK_AGENTS.some(a => a.pubkey === p));
    if (!agentPubkey) return;

    get().addMessage({
      id: crypto.randomUUID(),
      conversation_id: conversationId,
      sender_pubkey: agentPubkey,
      content: MOCK_REPLIES[Math.floor(Math.random() * MOCK_REPLIES.length)],
      timestamp: new Date().toISOString(),
      status: 'delivered',
    });
  }, delay);
}

function isMockMode(config: NostrConfig): boolean {
  return !config.private_key_hex;
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

    if (isMockMode(nostrConfig)) {
      // Mock mode: create fake conversations if none exist
      set({ connectionStatus: 'connected' });
      if (get().conversations.length === 0) {
        const mockPubkey = '0'.repeat(64);
        for (const agent of MOCK_AGENTS) {
          const convId = nostr.conversationId(mockPubkey, agent.pubkey);
          const now = new Date().toISOString();
          get().addMessage({
            id: crypto.randomUUID(),
            conversation_id: convId,
            sender_pubkey: agent.pubkey,
            content: `Hello! I'm ${agent.name}, ready to assist.`,
            timestamp: now,
            status: 'delivered',
          });
          // Set display name
          set((state) => ({
            conversations: state.conversations.map(c =>
              c.id === convId ? { ...c, display_name: agent.name } : c,
            ),
          }));
        }
      }
      return;
    }

    nostr.setHandlers(
      (msg) => get().addMessage(msg),
      (status) => get().setConnectionStatus(status),
    );

    nostr.connect(nostrConfig.private_key_hex!, nostrConfig.relays);
  },

  disconnect: () => {
    nostr.disconnect();
    set({ connectionStatus: 'disconnected' });
  },

  sendDm: async (recipientPubkey, content) => {
    const { nostrConfig } = get();

    if (isMockMode(nostrConfig)) {
      // Mock mode
      const mockPubkey = '0'.repeat(64);
      const convId = nostr.conversationId(mockPubkey, recipientPubkey);
      const msg: DmMessage = {
        id: crypto.randomUUID(),
        conversation_id: convId,
        sender_pubkey: mockPubkey,
        content,
        timestamp: new Date().toISOString(),
        status: 'sent',
      };
      get().addMessage(msg);
      mockReply(convId, get);
      return;
    }

    const sk = nostrConfig.private_key_hex!;
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

  loadPersisted: () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      set({
        conversations: data.conversations || [],
        messages: data.messages || {},
        nostrConfig: data.nostrConfig || { private_key_hex: null, relays: DEFAULT_RELAYS },
      });
    } catch { /* corrupt data — start fresh */ }
  },
}));

// --- Helpers ---

function truncatePubkey(pubkey: string): string {
  if (pubkey.length < 16) return pubkey;
  return pubkey.slice(0, 8) + '...' + pubkey.slice(-4);
}

function parseHexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}
