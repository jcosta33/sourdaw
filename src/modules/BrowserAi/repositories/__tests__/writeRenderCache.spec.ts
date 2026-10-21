import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readRenderCache } from '../readRenderCache';
import { writeRenderCache } from '../writeRenderCache';

vi.mock('../../models/StorageStatus', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../models/StorageStatus')>()),
    DEFAULT_CACHE_LIMIT_BYTES: 8,
}));

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);
const INDEX = 'recency.json';

type Entry = { kind: 'file'; bytes: Uint8Array; lastModified?: number } | { kind: 'directory' };

function storage() {
    const entries = new Map<string, Entry>();
    const removed: string[] = [];
    const aborted: string[] = [];
    let failWrite: string | undefined;
    let failClose: string | undefined;
    let tail = Promise.resolve();
    const requests: string[] = [];
    const directory = {
        kind: 'directory',
        async getFileHandle(name: string, options?: { create?: boolean }) {
            if (!entries.has(name)) {
                if (!options?.create) throw new DOMException('missing', 'NotFoundError');
                entries.set(name, { kind: 'file', bytes: new Uint8Array() });
            }
            if (entries.get(name)?.kind !== 'file') throw new DOMException('directory', 'TypeMismatchError');
            return {
                kind: 'file',
                async getFile() {
                    const entry = entries.get(name);
                    if (entry?.kind !== 'file') throw new Error('missing');
                    const bytes = entry.bytes.slice();
                    return {
                        size: bytes.byteLength,
                        lastModified: entry.lastModified ?? 0,
                        arrayBuffer: () => Promise.resolve(bytes.buffer),
                        text: () => Promise.resolve(new TextDecoder().decode(bytes)),
                    };
                },
                async createWritable() {
                    let pending = new Uint8Array();
                    return {
                        async write(data: ArrayBuffer | ArrayBufferView | string) {
                            if (failWrite === name) throw new Error('write failed');
                            if (typeof data === 'string') pending = new TextEncoder().encode(data);
                            else if (ArrayBuffer.isView(data))
                                pending = new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice();
                            else pending = new Uint8Array(data).slice();
                        },
                        async close() {
                            if (failClose === name) throw new Error('close failed');
                            entries.set(name, { kind: 'file', bytes: pending });
                        },
                        async abort() {
                            aborted.push(name);
                        },
                    };
                },
            };
        },
        async removeEntry(name: string) {
            removed.push(name);
            entries.delete(name);
        },
        async *[Symbol.asyncIterator]() {
            for (const [name, entry] of entries) {
                yield [name, entry.kind === 'directory' ? entry : await directory.getFileHandle(name)];
            }
        },
    };
    const locks = {
        request(name: string, _options: LockOptions, operation: () => Promise<unknown>) {
            requests.push(name);
            const result = tail.then(operation);
            tail = result.then(
                () => undefined,
                () => undefined
            );
            return result;
        },
    };
    const root = { getDirectoryHandle: vi.fn(async () => directory) };
    Object.defineProperty(navigator, 'storage', {
        configurable: true,
        value: { getDirectory: vi.fn(async () => root) },
    });
    Object.defineProperty(navigator, 'locks', { configurable: true, value: locks });
    return {
        entries,
        removed,
        aborted,
        requests,
        failWrite(name: string) {
            failWrite = name;
        },
        failClose(name: string) {
            failClose = name;
        },
        seed(name: string, bytes: Uint8Array, lastModified = 0) {
            entries.set(name, { kind: 'file', bytes, lastModified });
        },
        payloadBytes() {
            return [...entries]
                .filter(([name]) => name.endsWith('.pcm'))
                .reduce((sum, [, entry]) => sum + (entry.kind === 'file' ? entry.bytes.length : 0), 0);
        },
    };
}

let disk: ReturnType<typeof storage>;
beforeEach(() => {
    disk = storage();
});
afterEach(() => {
    vi.restoreAllMocks();
});
const write = (cacheKey: string, samples = [1]) => writeRenderCache({ cacheKey, audio: new Float32Array(samples) });
const read = (cacheKey: string) => readRenderCache({ cacheKey });

describe('bounded render cache', () => {
    it('persists read recency so admitting C evicts B after A was reused', async () => {
        await write(A);
        await write(B);
        expect(await read(A)).toEqual(new Float32Array([1]));
        vi.resetModules();
        const restarted = await import('../writeRenderCache');
        await restarted.writeRenderCache({ cacheKey: C, audio: new Float32Array([1]) });
        expect(await read(B)).toBeNull();
        expect(await read(A)).not.toBeNull();
        expect(await read(C)).not.toBeNull();
        expect(disk.payloadBytes()).toBe(8);
        expect(disk.removed).toEqual([`${B}.pcm`]);
    });

    it('accounts for replacement bytes once and skips oversized entries without evicting', async () => {
        await write(A);
        await write(B);
        await write(A, [2]);
        expect(disk.removed).toEqual([]);
        await write(C, [1, 2, 3]);
        expect(disk.entries.has(`${C}.pcm`)).toBe(false);
        expect(disk.removed).toEqual([]);
        await write(A, [2, 3]);
        expect(disk.removed).toEqual([`${B}.pcm`]);
        expect(disk.payloadBytes()).toBe(8);
    });

    it('writes exactly the Float32Array view', async () => {
        const audio = new Float32Array([9, 2, 3, 9]).subarray(1, 3);
        await writeRenderCache({ cacheKey: A, audio });
        expect(await read(A)).toEqual(new Float32Array([2, 3]));
        expect(disk.payloadBytes()).toBe(8);
    });

    it('rejects unsafe keys and empty or misaligned PCM', async () => {
        await write('../models/model');
        await write(A, []);
        disk.seed(`${B}.pcm`, new Uint8Array(3));
        disk.seed(`${C}.pcm`, new Uint8Array());
        expect(await read('../models/model')).toBeNull();
        expect(await read(B)).toBeNull();
        expect(await read(C)).toBeNull();
        expect(disk.entries.has('../models/model.pcm')).toBe(false);
        expect(disk.entries.has(`${A}.pcm`)).toBe(false);
    });

    it.each(['write', 'close'] as const)('aborts a failed %s and preserves an existing entry', async (failure) => {
        await write(A);
        if (failure === 'write') disk.failWrite(`${A}.pcm`);
        else disk.failClose(`${A}.pcm`);
        await write(A, [2]);
        expect(await read(A)).toEqual(new Float32Array([1]));
        expect(disk.aborted).toContain(`${A}.pcm`);
        expect(disk.removed).not.toContain(`${A}.pcm`);
    });

    it('removes a newly created failed payload and reconciles a failed index commit', async () => {
        disk.failWrite(`${A}.pcm`);
        await write(A);
        expect(disk.entries.has(`${A}.pcm`)).toBe(false);
        disk.failClose(INDEX);
        await write(B);
        await write(C);
        expect(await read(B)).not.toBeNull();
        expect(await read(C)).not.toBeNull();
        expect(disk.payloadBytes()).toBe(8);
    });

    it('reconciles stale and malicious indexes without deleting unrelated files or directories', async () => {
        disk.seed(`${A}.pcm`, new Uint8Array(new Float32Array([1]).buffer));
        disk.seed(`${B}.pcm`, new Uint8Array(new Float32Array([2]).buffer));
        disk.seed(INDEX, new TextEncoder().encode(JSON.stringify(['../models/model', C, B, B, A])));
        disk.seed('unknown.pcm', new Uint8Array());
        disk.entries.set(`${C}.pcm`, { kind: 'directory' });
        await read(A);
        await write(C);
        expect(disk.entries.has(`${A}.pcm`)).toBe(true);
        expect(disk.entries.has('unknown.pcm')).toBe(true);
        expect(disk.entries.get(`${C}.pcm`)?.kind).toBe('directory');
        expect(disk.entries.has(`${B}.pcm`)).toBe(true);
        expect(disk.removed.every((name) => name === `${B}.pcm`)).toBe(true);
    });

    it('recovers a corrupt index and serialized writes from independent module instances', async () => {
        disk.seed(INDEX, new TextEncoder().encode('{broken'));
        await write(A);
        await read(A);
        vi.resetModules();
        const restarted = await import('../writeRenderCache');
        await Promise.all([write(B), restarted.writeRenderCache({ cacheKey: C, audio: new Float32Array([3]) })]);
        expect(disk.payloadBytes()).toBe(8);
        expect(await read(A)).toBeNull();
        expect(await read(B)).not.toBeNull();
        expect(await read(C)).not.toBeNull();
        expect(new Set(disk.requests)).toEqual(new Set(['sourdaw:render-cache']));
    });

    it.each(['absent', 'corrupt'])('evicts the oldest cold file when its recency index is %s', async (indexState) => {
        disk.seed(`${B}.pcm`, new Uint8Array(new Float32Array([2]).buffer), 100);
        disk.seed(`${A}.pcm`, new Uint8Array(new Float32Array([1]).buffer), 200);
        if (indexState === 'corrupt') disk.seed(INDEX, new TextEncoder().encode('{broken'));

        await write(C);

        expect(disk.removed).toEqual([`${B}.pcm`]);
        expect(await read(A)).not.toBeNull();
        expect(await read(C)).not.toBeNull();
        expect(disk.payloadBytes()).toBe(8);
    });

    it('refuses admission without eviction when an unknown directory prevents byte accounting', async () => {
        await write(A);
        await write(B);
        disk.entries.set('foreign-directory', { kind: 'directory' });
        const before = [...disk.entries];

        await write(C);

        expect([...disk.entries]).toEqual(before);
        expect(disk.removed).toEqual([]);
        expect(await read(A)).not.toBeNull();
        expect(await read(B)).not.toBeNull();
    });

    it('counts unknown payloads without deleting them to admit a render', async () => {
        disk.seed('unrelated.bin', new Uint8Array(5));
        await write(A);
        expect(disk.entries.has(`${A}.pcm`)).toBe(false);
        expect(disk.entries.has('unrelated.bin')).toBe(true);
        expect(disk.removed).toEqual([]);
    });

    it.each(['storage', 'locks'])('keeps rendering best effort when %s is unavailable', async (unavailable) => {
        if (unavailable === 'locks')
            Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
        else
            Object.defineProperty(navigator, 'storage', {
                configurable: true,
                value: { getDirectory: vi.fn().mockRejectedValue(new Error('OPFS unavailable')) },
            });
        await expect(write(A)).resolves.toBeUndefined();
        expect(await read(A)).toBeNull();
    });
});
