/**
 * Blossom (BUD-01/02) upload utility for encrypted media exchange.
 *
 * Flow:
 * 1. AES-256-GCM encrypt the raw image bytes (no size limit)
 * 2. Compute SHA-256 hash of the encrypted payload
 * 3. Sign a BUD-02 authorization event (kind 24242)
 * 4. HTTP PUT to Blossom server with signed auth header
 * 5. Return hash, URL, and AES key+IV (sent to bridge via NIP-44 message)
 *
 * The bridge downloads the encrypted blob, verifies the hash, and AES-GCM decrypts.
 */

import { finalizeEvent } from 'nostr-tools/pure';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { isTauri } from '../ipc/tauri';

export const DEFAULT_BLOSSOM_SERVER = 'https://blossom.descendant.io';

export interface BlossomUploadResult {
  /** SHA-256 hex hash of the uploaded (encrypted) blob */
  hash: string;
  /** Full URL to download the blob: ${server}/${hash} */
  url: string;
  /** Hex-encoded AES-256 key (32 bytes) */
  key: string;
  /** Hex-encoded AES-GCM IV (12 bytes) */
  iv: string;
}

/**
 * AES-256-GCM encrypt image data and upload to a Blossom server.
 *
 * @param base64Data - Raw base64-encoded image (no data: prefix)
 * @param secretKeyBytes - Phone's Nostr private key (Uint8Array) — used for BUD-02 auth signing
 * @param serverUrl - Blossom server base URL (e.g., https://blossom.primal.net)
 * @returns Hash, URL, key, and IV of the uploaded encrypted blob
 */
export async function uploadToBlossom(
  base64Data: string,
  secretKeyBytes: Uint8Array,
  serverUrl: string = DEFAULT_BLOSSOM_SERVER,
): Promise<BlossomUploadResult> {
  // 1. Decode base64 to raw image bytes
  const binaryString = atob(base64Data);
  const rawBytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    rawBytes[i] = binaryString.charCodeAt(i);
  }

  // 2. AES-256-GCM encrypt (no size limit)
  const key = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cryptoKey = await crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['encrypt']);
  const encryptedBuffer = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, rawBytes);
  const encryptedBytes = new Uint8Array(encryptedBuffer);

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

  // 6. HTTP PUT to Blossom server (Tauri plugin fetch bypasses Android WebView restrictions)
  const httpFetch = isTauri() ? tauriFetch : fetch;
  const uploadUrl = `${serverUrl.replace(/\/$/, '')}/upload`;
  const response = await httpFetch(uploadUrl, {
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
  return { hash: hashHex, url: blobUrl, key: bytesToHex(key), iv: bytesToHex(iv) };
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}
