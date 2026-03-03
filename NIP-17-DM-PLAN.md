# NIP-17 DMs for CodeDeck

## Context

CodeDeck currently has no Nostr integration. The goal is to add NIP-17 private direct messaging so the user can communicate with their openclaw agents via encrypted DMs. DM conversations should appear as tiles in the sidebar below the work session tiles, and selecting one shows a chat view in the main panel.

## Approach: `nostr-tools` in the Frontend

Use the `nostr-tools` npm package directly in the React frontend. It provides NIP-44 encryption, NIP-59 gift wrap, and relay pool management — everything needed for NIP-17. No Rust backend changes required.

- Lightweight (~50KB), no WASM
- WebSocket relay connections work natively in the Tauri webview
- All crypto stays in the frontend — private key never crosses IPC

## Implementation Steps

### Step 1: Foundation — Types & Dependency

**Install:** `npm install nostr-tools`

**Modify** `src/types.ts` — add at end:
```typescript
export type PanelMode = 'session' | 'dm';

export interface NostrConfig {
  private_key_hex: string | null;
  relays: string[];  // defaults: ['wss://relay.damus.io', 'wss://nos.lol']
}

export interface DmConversation {
  id: string;              // sorted participant pubkeys joined with ':'
  participants: string[];  // hex pubkeys including self
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
```

**Modify** `src/stores/uiStore.ts` — add `panelMode: PanelMode` and `setPanelMode`

### Step 2: Nostr Service (Protocol Layer)

**Create** `src/services/nostrService.ts`

Core functions using nostr-tools:
- `connect(privateKeyHex, relays)` — create `SimplePool`, subscribe to `kind:1059` gift wraps addressed to own pubkey
- `disconnect()` — close pool
- `sendDirectMessage(senderSk, recipientPubkey, content, relays)` — build kind 14 rumor → `nip59.wrapEvent()` for recipient + self → publish both via pool
- `processGiftWrap(event, recipientSk)` — `nip59.unwrapEvent()` → extract DmMessage
- `parsePrivateKey(input)` — accepts nsec or hex, returns Uint8Array
- `getPubkeyHex(sk)` — derive hex pubkey

Key imports:
```typescript
import { getPublicKey } from 'nostr-tools/pure'
import { SimplePool } from 'nostr-tools/pool'
import * as nip19 from 'nostr-tools/nip19'
import * as nip59 from 'nostr-tools/nip59'
```

### Step 3: DM Store (State Management)

**Create** `src/stores/dmStore.ts` — Zustand store

```
State: conversations[], messages Record<convId, DmMessage[]>,
       activeConversationId, nostrConfig, connectionStatus

Actions: setActiveConversation, addMessage, markConversationRead,
         updateNostrConfig, connect, disconnect, sendDm, loadPersisted
```

- On `addMessage`: upsert conversation, update `last_message_at`, increment `unread_count` (unless conversation is active)
- Messages capped at 500 per conversation
- Persist conversations + messages to `localStorage` keyed by pubkey
- Mock mode: generates fake conversations + auto-replies (same pattern as `mockAgentResponse` in `src/stores/sessionStore.ts`)

### Step 4: Settings — Nostr Identity

**Modify** `src/components/SettingsModal.tsx`

Add "Nostr Identity" section after "Authentication":
- Private key input (password field with show/hide toggle — same pattern as API key)
- Read-only derived public key display (for verification)
- DM relays textarea (one URL per line)

Nostr config saved separately via `dmStore.updateNostrConfig()` (stored in localStorage, not in Tauri AppConfig).

### Step 5: DM Tiles in Sidebar

**Create** `src/components/DmTile.tsx`
- Same visual structure as `SessionCard` (64px height, border-left, name + subtitle)
- Shows: display_name, relative time of last message, unread badge
- On click: `dmStore.setActiveConversation(id)` + `uiStore.setPanelMode('dm')`

**Modify** `src/components/Sidebar.tsx`

Split the sidebar into two regions using flexbox:
```
┌─────────────────────┐
│ Sessions header [+] │  ← flex-shrink: 0
├─────────────────────┤
│                     │
│  Session tiles      │  ← flex: 1, overflow-y: auto (scrollable)
│  (grouped)          │
│                     │
├─────────────────────┤
│ DMs heading     [+] │  ← fixed bottom section
│ ─────────────────── │     height: 2 tiles (128px) + heading (~30px)
│ DmTile 1            │     overflow-y: auto if more than 2 conversations
│ DmTile 2            │
└─────────────────────┘
```

- The DMs section is **pinned to the bottom** of the sidebar with a fixed height (~160px: heading + 2 × 64px tiles)
- Sessions fill all remaining space above, scrolling independently
- The DMs section scrolls independently if there are more than 2 conversations
- "+" button next to DMs heading opens inline input to paste recipient npub/hex
- A thin border-top separates the DMs section from sessions
- Connection status dot in the DMs heading
- Update `SessionCard` onClick to also call `setPanelMode('session')`

**Create** `src/styles/dm.css` — styles for DmTile, conversation view, message bubbles

### Step 6: Conversation View in Main Panel

**Create** `src/components/DmConversationView.tsx`
- Header: conversation name + participant info
- Message list: scrollable div, sent messages right-aligned, received left-aligned
- Input bar at bottom: textarea, Enter to send, Shift+Enter for newline
- Instant-scroll to bottom on new messages (no smooth animation)

**Modify** `src/components/MainPanel.tsx`
- Check `panelMode` from uiStore
- If `'dm'` + activeConversationId → render `DmConversationView`
- If `'session'` + activeSession → render existing session view (unchanged)
- Otherwise → "Select or create a session" placeholder

### Step 7: App Wiring

**Modify** `src/App.tsx`
- On mount: call `dmStore.loadPersisted()` then `dmStore.connect()`
- Import `dm.css`

## Files Summary

| New files | Purpose |
|-----------|---------|
| `src/services/nostrService.ts` | NIP-17 protocol + relay pool |
| `src/stores/dmStore.ts` | DM state management |
| `src/components/DmTile.tsx` | Sidebar conversation tile |
| `src/components/DmConversationView.tsx` | Chat message view + input |
| `src/styles/dm.css` | DM styles |

| Modified files | Change |
|----------------|--------|
| `package.json` | Add `nostr-tools` |
| `src/types.ts` | Add DM types + PanelMode |
| `src/stores/uiStore.ts` | Add panelMode |
| `src/components/Sidebar.tsx` | Add DMs section |
| `src/components/MainPanel.tsx` | Switch session/DM view |
| `src/components/SettingsModal.tsx` | Add Nostr Identity section |
| `src/App.tsx` | Init DM store on mount |

## Verification

1. **Mock mode** (no key): Start dev server (`npm run dev`), see two mock DM conversations in sidebar, click to view, send messages and receive auto-replies
2. **Real mode**: Enter nsec in Settings, add relay URLs (e.g. `wss://relay.damus.io`), verify connection status dot turns green, send a DM to a known pubkey, verify it arrives on the other end, verify incoming DMs appear
3. **Panel switching**: Click session tile → session view, click DM tile → DM view, verify both work correctly
4. **Persistence**: Reload page, verify conversations and messages persist
5. **Run tests**: `npm test`
