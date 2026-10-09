import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createChunkedStorage, MAX_CHUNK_BYTES, splitIntoChunks, type SecureBackend } from '../../src/lib/chunkedStorage.ts';

function memoryBackend(): SecureBackend & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItemAsync: async (k) => data.get(k) ?? null,
    setItemAsync: async (k, v) => {
      data.set(k, v);
    },
    deleteItemAsync: async (k) => {
      data.delete(k);
    },
  };
}

const bytes = (s: string) => new TextEncoder().encode(s).length;

test('round-trips a short value', async () => {
  const s = createChunkedStorage(memoryBackend());
  await s.setItem('sb-ref-auth-token', 'hello');
  assert.equal(await s.getItem('sb-ref-auth-token'), 'hello');
});

test('splits a large session into chunks under the size limit', async () => {
  const backend = memoryBackend();
  const s = createChunkedStorage(backend);
  const big = 'x'.repeat(5000);
  await s.setItem('key', big);
  assert.equal(await s.getItem('key'), big);
  assert.equal(backend.data.get('key.count'), '3');
  for (const [k, v] of backend.data) {
    if (k !== 'key.count') assert.ok(bytes(v) <= MAX_CHUNK_BYTES);
  }
});

test('never splits a multi-byte character', () => {
  const value = 'é'.repeat(1000) + '名'.repeat(1000);
  const chunks = splitIntoChunks(value, 100);
  assert.equal(chunks.join(''), value);
  for (const c of chunks) assert.ok(bytes(c) <= 100);
});

test('shrinking a value removes leftover chunks', async () => {
  const backend = memoryBackend();
  const s = createChunkedStorage(backend);
  await s.setItem('key', 'x'.repeat(5000));
  await s.setItem('key', 'short');
  assert.equal(await s.getItem('key'), 'short');
  assert.deepEqual([...backend.data.keys()].sort(), ['key.0', 'key.count']);
});

test('removeItem deletes every chunk', async () => {
  const backend = memoryBackend();
  const s = createChunkedStorage(backend);
  await s.setItem('key', 'x'.repeat(5000));
  await s.removeItem('key');
  assert.equal(backend.data.size, 0);
  assert.equal(await s.getItem('key'), null);
});

test('a missing chunk is treated as signed out, not a corrupted token', async () => {
  const backend = memoryBackend();
  const s = createChunkedStorage(backend);
  await s.setItem('key', 'x'.repeat(5000));
  backend.data.delete('key.1');
  assert.equal(await s.getItem('key'), null);
});

test('rejects keys secure storage cannot hold', async () => {
  const s = createChunkedStorage(memoryBackend());
  await assert.rejects(() => s.setItem('bad key/../x', 'v'));
});
