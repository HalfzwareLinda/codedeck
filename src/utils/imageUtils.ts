/**
 * Image processing utilities for the image attachment feature.
 * Handles reading files, optional resizing (only for very large images),
 * and chunking base64 data for Nostr relay transport.
 *
 * Screenshots are kept as PNG (lossless) to preserve text readability.
 * Only images exceeding 3840px on any side are resized via canvas.
 */

const MAX_DIMENSION = 3840;

export interface ProcessedImage {
  base64: string;       // raw base64 (no data: prefix)
  mimeType: string;     // 'image/png' or 'image/jpeg'
  filename: string;
  sizeBytes: number;    // approximate size of the base64-decoded data
}

/**
 * Process a File from an <input type="file"> element.
 * Keeps original format. Only loads into canvas if resize is needed (>3840px).
 * For normal screenshots, reads the raw bytes directly — no re-encoding.
 */
export async function processImageFile(file: File): Promise<ProcessedImage> {
  const mimeType = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png';
  const filename = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');

  // Check dimensions to see if resize is needed
  const dataUrl = await readFileAsDataUrl(file);
  const img = await loadImage(dataUrl);
  const needsResize = img.width > MAX_DIMENSION || img.height > MAX_DIMENSION;

  let base64: string;

  if (needsResize) {
    // Scale down preserving aspect ratio via canvas
    const scale = Math.min(MAX_DIMENSION / img.width, MAX_DIMENSION / img.height);
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0, w, h);

    const resizedDataUrl = canvas.toDataURL(mimeType, mimeType === 'image/jpeg' ? 0.92 : undefined);
    base64 = resizedDataUrl.split(',')[1];
  } else {
    // No resize — read original bytes directly (no canvas re-encoding)
    const buffer = await file.arrayBuffer();
    base64 = arrayBufferToBase64(buffer);
  }

  const sizeBytes = Math.round(base64.length * 0.75);
  return { base64, mimeType, filename, sizeBytes };
}

/**
 * Split a base64 string into chunks that fit within Nostr event size limits.
 * 35KB per chunk leaves room for JSON envelope + NIP-44 encryption overhead
 * within the ~48KB total relay event limit.
 */
export function chunkBase64(base64: string, maxChunkBytes: number = 35_000): string[] {
  if (base64.length <= maxChunkBytes) {
    return [base64];
  }
  const chunks: string[] = [];
  for (let i = 0; i < base64.length; i += maxChunkBytes) {
    chunks.push(base64.slice(i, i + maxChunkBytes));
  }
  return chunks;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = src;
  });
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
