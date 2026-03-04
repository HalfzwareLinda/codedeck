/**
 * Blossom (BUD-01/02) upload utility for encrypted media exchange.
 *
 * Flow:
 * 1. NIP-44 encrypt the base64 image data (server sees only random bytes)
 * 2. Compute SHA-256 hash of the encrypted payload
 * 3. Sign a BUD-02 authorization event (kind 24242)
 * 4. HTTP PUT to Blossom server with signed auth header
 *
 * The bridge downloads the encrypted blob, verifies the hash, and decrypts.
 */

import { encrypt, getConversationKey } from 'nostr-tools/nip44';
import { finalizeEvent } from 'nostr-tools/pure';

export const DEFAULT_BLOSSOM_SERVER = 'https://blossom.primal.net';

export interface BlossomUploadResult {
  /** SHA-256 hex hash of the uploaded (encrypted) blob */
  hash: string;
  /** Full URL to download the blob: ${server}/${hash} */
  url: string;
}

/**
 * Encrypt image data with NIP-44 and upload to a Blossom server.
 *
 * @param base64Data - Raw base64-encoded image (no data: prefix)
 * @param secretKeyBytes - Phone's Nostr private key (Uint8Array)
 * @param bridgePubkeyHex - Bridge's public key hex (for NIP-44 conversation key)
 * @param serverUrl - Blossom server base URL (e.g., https://blossom.primal.net)
 * @returns Hash and URL of the uploaded encrypted blob
 */
export async function uploadToBlossom(
  base64Data: string,
  secretKeyBytes: Uint8Array,
  bridgePubkeyHex: string,
  serverUrl: string = DEFAULT_BLOSSOM_SERVER,
): Promise<BlossomUploadResult> {
  // 1. NIP-44 encrypt the base64 string
  const conversationKey = getConversationKey(secretKeyBytes, bridgePubkeyHex);
  const encrypted = encrypt(base64Data, conversationKey);

  // 2. Convert encrypted string to bytes for upload
  const encoder = new TextEncoder();
  const encryptedBytes = encoder.encode(encrypted);

  // 3. Compute SHA-256 hash of the encrypted payload
  const hashBuffer = await crypto.subtle.digest('SHA-256', encryptedBytes);
  const hashHex = bytesToHex(new Uint8Array(hashBuffer));

  // 4. Create BUD-02 authorization event (kind 24242)
  const authEvent = finalizeEvent({
    kind: 24242,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['t', 'upload'],
      ['x', hashHex],
      ['expiration', String(Math.floor(Date.now() / 1000) + 300)], // 5 min
    ],
    content: 'Upload encrypted image via Codedeck',
  }, secretKeyBytes);

  // 5. Base64-encode the signed auth event for the Authorization header
  const authJson = JSON.stringify(authEvent);
  const authBase64 = btoa(authJson);

  // 6. HTTP PUT to Blossom server
  const uploadUrl = `${serverUrl.replace(/\/$/, '')}/upload`;
  const response = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Authorization': `Nostr ${authBase64}`,
      'Content-Type': 'application/octet-stream',
    },
    body: encryptedBytes,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Blossom upload failed: ${response.status} ${response.statusText}${body ? ` — ${body}` : ''}`);
  }

  const blobUrl = `${serverUrl.replace(/\/$/, '')}/${hashHex}`;
  return { hash: hashHex, url: blobUrl };
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}
