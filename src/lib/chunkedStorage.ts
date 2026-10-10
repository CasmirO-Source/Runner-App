// Splits long values across several secure storage entries.
//
// The Supabase login session (access token, refresh token and user details)
// must live in the phone's secure storage: the iOS Keychain or Android
// Keystore. iOS can reject single values over about 2 KB, and a session can be
// larger, so each value is stored as numbered chunks plus a count.
//
// Pure module with no React Native imports, so it can be unit tested in Node.

export type SecureBackend = {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
};

export type KeyValueStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

// Secure storage keys may only use these characters.
const VALID_KEY = /^[A-Za-z0-9._-]+$/;
export const MAX_CHUNK_BYTES = 1800;

function assertValidKey(key: string): void {
  if (!VALID_KEY.test(key)) {
    throw new Error('Invalid secure storage key');
  }
}

// Splits on whole characters so multi-byte characters are never cut in half.
export function splitIntoChunks(value: string, maxBytes: number = MAX_CHUNK_BYTES): string[] {
  const encoder = new TextEncoder();
  const chunks: string[] = [];
  let current = '';
  let currentBytes = 0;
  for (const char of value) {
    const bytes = encoder.encode(char).length;
    if (currentBytes + bytes > maxBytes && current !== '') {
      chunks.push(current);
      current = '';
      currentBytes = 0;
    }
    current += char;
    currentBytes += bytes;
  }
  if (current !== '' || chunks.length === 0) {
    chunks.push(current);
  }
  return chunks;
}

export function createChunkedStorage(backend: SecureBackend): KeyValueStorage {
  const countKey = (key: string) => `${key}.count`;
  const chunkKey = (key: string, index: number) => `${key}.${index}`;

  async function readCount(key: string): Promise<number> {
    const raw = await backend.getItemAsync(countKey(key));
    const count = raw === null ? 0 : Number(raw);
    return Number.isInteger(count) && count > 0 ? count : 0;
  }

  async function deleteChunks(key: string, from: number, to: number): Promise<void> {
    for (let i = from; i < to; i++) {
      await backend.deleteItemAsync(chunkKey(key, i));
    }
  }

  return {
    async getItem(key) {
      assertValidKey(key);
      const count = await readCount(key);
      if (count === 0) {
        return null;
      }
      let value = '';
      for (let i = 0; i < count; i++) {
        const chunk = await backend.getItemAsync(chunkKey(key, i));
        // A missing chunk means the stored session is incomplete. Treat it as
        // signed out rather than handing Supabase a corrupted token.
        if (chunk === null) {
          return null;
        }
        value += chunk;
      }
      return value;
    },

    async setItem(key, value) {
      assertValidKey(key);
      const previousCount = await readCount(key);
      const chunks = splitIntoChunks(value);
      for (let i = 0; i < chunks.length; i++) {
        await backend.setItemAsync(chunkKey(key, i), chunks[i]);
      }
      await backend.setItemAsync(countKey(key), String(chunks.length));
      // Remove leftover chunks from a previous, longer value.
      await deleteChunks(key, chunks.length, previousCount);
    },

    async removeItem(key) {
      assertValidKey(key);
      const count = await readCount(key);
      await backend.deleteItemAsync(countKey(key));
      await deleteChunks(key, 0, count);
    },
  };
}
