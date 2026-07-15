import { afterEach, describe, it, expect, vi } from 'vitest';

import { audioBufferCache } from '../audioBufferCache';

function createAudioBuffer({ length, sampleRate }: { length: number; sampleRate: number }): AudioBuffer {
    const channels = Array.from({ length: 1 }, () => new Float32Array(length));
    return {
        copyFromChannel: (destination, channelNumber, startInChannel = 0) => {
            destination.set(channels[channelNumber]!.subarray(startInChannel, startInChannel + destination.length));
        },
        copyToChannel: (source, channelNumber, startInChannel = 0) => {
            channels[channelNumber]!.set(source, startInChannel);
        },
        duration: length / sampleRate,
        getChannelData: (channelNumber) => channels[channelNumber]!,
        length,
        numberOfChannels: 1,
        sampleRate,
    };
}

function encodeFloat32(values: number[]): string {
    const bytes = new Uint8Array(new Float32Array(values).buffer);
    let binary = '';
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary);
}

// Test the pure conversion functions by importing them indirectly
// since they're not exported. We test them through the module's
// public API where possible, or test the pattern directly.

describe('audioBufferCache conversions', () => {
    afterEach(() => {
        audioBufferCache.clear();
    });

    it('Float32Array to base64 round-trip preserves data', async () => {
        const original = new Float32Array([0.5, -0.5, 0.25, -0.25, 0.0]);
        const bytes = new Uint8Array(original.buffer, original.byteOffset, original.byteLength);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]!);
        }
        const b64 = btoa(binary);

        // Decode back
        const decoded_binary = atob(b64);
        const decoded_bytes = new Uint8Array(decoded_binary.length);
        for (let i = 0; i < decoded_binary.length; i++) {
            decoded_bytes[i] = decoded_binary.charCodeAt(i);
        }
        const decoded = new Float32Array(decoded_bytes.buffer);

        expect(Array.from(decoded)).toEqual(Array.from(original));
    });

    it('round-trip with large Float32Array', async () => {
        const original = new Float32Array(10000);
        for (let i = 0; i < original.length; i++) {
            original[i] = Math.sin(i * 0.01);
        }

        const bytes = new Uint8Array(original.buffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]!);
        }
        const b64 = btoa(binary);

        const decoded_binary = atob(b64);
        const decoded_bytes = new Uint8Array(decoded_binary.length);
        for (let i = 0; i < decoded_binary.length; i++) {
            decoded_bytes[i] = decoded_binary.charCodeAt(i);
        }
        const decoded = new Float32Array(decoded_bytes.buffer);

        expect(decoded.length).toBe(original.length);
        expect(decoded[5000]).toBeCloseTo(original[5000]!, 5);
    });

    it('empty Float32Array round-trips correctly', () => {
        const original = new Float32Array(0);
        const bytes = new Uint8Array(original.buffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]!);
        }
        const b64 = btoa(binary);

        const decoded_binary = atob(b64);
        const decoded_bytes = new Uint8Array(decoded_binary.length);
        for (let i = 0; i < decoded_binary.length; i++) {
            decoded_bytes[i] = decoded_binary.charCodeAt(i);
        }
        const decoded = new Float32Array(decoded_bytes.buffer);

        expect(decoded.length).toBe(0);
    });

    it('single-element Float32Array round-trips', () => {
        const original = new Float32Array([1.0]);
        const bytes = new Uint8Array(original.buffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]!);
        }
        const b64 = btoa(binary);

        const decoded_binary = atob(b64);
        const decoded_bytes = new Uint8Array(decoded_binary.length);
        for (let i = 0; i < decoded_binary.length; i++) {
            decoded_bytes[i] = decoded_binary.charCodeAt(i);
        }
        const decoded = new Float32Array(decoded_bytes.buffer);

        expect(decoded[0]).toBeCloseTo(1.0, 5);
    });

    it('stages valid PCM until publish and rejects malformed or canceled candidates', async () => {
        const context = {
            createBuffer: vi.fn((numberOfChannels: number, length: number, sampleRate: number) => {
                expect(numberOfChannels).toBe(1);
                return createAudioBuffer({ length, sampleRate });
            }),
        };
        const first = { sampleRate: 48_000, numberOfChannels: 1, channelData: [encodeFloat32([0.25])] };
        const second = { sampleRate: 48_000, numberOfChannels: 1, channelData: [encodeFloat32([0.75])] };

        const firstCandidate = audioBufferCache.importBuffers({ context, buffers: { shared: first } });
        expect(audioBufferCache.get('shared')).toBeUndefined();
        await expect(firstCandidate?.persist()).resolves.toBe(true);
        firstCandidate?.publish();

        const canceledCandidate = audioBufferCache.importBuffers({
            context,
            buffers: { shared: second },
            shouldContinue: () => false,
        });
        expect(canceledCandidate).toBeNull();
        expect(audioBufferCache.get('shared')?.getChannelData(0)[0]).toBeCloseTo(0.25);

        const malformedCandidate = audioBufferCache.importBuffers({
            context,
            buffers: {
                shared: { sampleRate: 48_000, numberOfChannels: 1, channelData: ['not-base64'] },
            },
        });
        expect(malformedCandidate).toBeNull();
        expect(audioBufferCache.get('shared')?.getChannelData(0)[0]).toBeCloseTo(0.25);

        const unavailableNonresidentCandidate = audioBufferCache.importBuffers({
            context,
            buffers: { shared: second, archived: first },
            cacheIds: ['shared'],
        });
        await expect(unavailableNonresidentCandidate?.persist()).resolves.toBe(false);

        const secondCandidate = audioBufferCache.importBuffers({ context, buffers: { shared: second } });
        await expect(secondCandidate?.persist()).resolves.toBe(true);
        secondCandidate?.publish();
        expect(audioBufferCache.get('shared')?.getChannelData(0)[0]).toBeCloseTo(0.75);
        expect(audioBufferCache.get('archived')).toBeUndefined();
    });

    it('validates every embedded buffer before opening a persistence transaction', () => {
        const open = vi.fn();
        vi.stubGlobal('indexedDB', { open });
        const context = {
            createBuffer: vi.fn(() => ({ getChannelData: () => new Float32Array(1) })),
        } as unknown as BaseAudioContext;

        try {
            expect(
                audioBufferCache.importBuffers({
                    context,
                    buffers: {
                        valid: { sampleRate: 48_000, numberOfChannels: 1, channelData: [encodeFloat32([0.25])] },
                        invalid: { sampleRate: 48_000, numberOfChannels: 1, channelData: ['not-base64'] },
                    },
                })
            ).toBeNull();
            expect(open).not.toHaveBeenCalled();
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('does not let a stale remove delete a newer persisted buffer', async () => {
        const requests: Array<{
            error: Error | null;
            onerror: (() => void) | null;
            onsuccess: (() => void) | null;
            result: unknown;
        }> = [];
        const transactions: Array<{
            error: Error | null;
            onabort: (() => void) | null;
            oncomplete: (() => void) | null;
            onerror: (() => void) | null;
        }> = [];
        const store = {
            delete: vi.fn(),
            put: vi.fn(),
        };
        const database = {
            objectStoreNames: { contains: () => true },
            transaction: vi.fn(() => {
                const transaction = {
                    error: null,
                    objectStore: () => store,
                    onabort: null,
                    oncomplete: null,
                    onerror: null,
                };
                transactions.push(transaction);
                return transaction;
            }),
        };
        const open = vi.fn(() => {
            const request = {
                error: null,
                onerror: null,
                onsuccess: null,
                result: database,
            };
            requests.push(request);
            return request;
        });
        vi.stubGlobal('indexedDB', { open });

        try {
            audioBufferCache.remove('race');
            audioBufferCache.set('race', createAudioBuffer({ length: 1, sampleRate: 48_000 }));

            expect(requests).toHaveLength(2);

            requests[1]!.onsuccess?.();
            await Promise.resolve();
            expect(store.put).toHaveBeenCalledWith(expect.anything(), 'race');
            expect(transactions).toHaveLength(1);

            transactions[0]!.oncomplete?.();
            await Promise.resolve();

            requests[0]!.onsuccess?.();
            await Promise.resolve();

            expect(store.delete).not.toHaveBeenCalled();
            expect(transactions).toHaveLength(1);
        } finally {
            for (const transaction of transactions) {
                transaction.oncomplete?.();
            }
            vi.unstubAllGlobals();
        }
    });

    it('keeps every active-project buffer resident when the project exceeds the LRU cap', async () => {
        const exported = { sampleRate: 48_000, numberOfChannels: 1, channelData: [encodeFloat32([0.25])] };
        const ids = Array.from({ length: 65 }, (_, index) => `active-${index}`);
        const buffers = Object.fromEntries(ids.map((id) => [id, exported]));
        const context = {
            createBuffer: vi.fn(() => ({ getChannelData: () => new Float32Array(1) })),
        } as unknown as BaseAudioContext;

        const prepared = audioBufferCache.importBuffers({ context, buffers, cacheIds: ids });
        await expect(prepared?.persist()).resolves.toBe(true);
        prepared?.publish();

        expect(audioBufferCache.get(ids[0]!)).toBeDefined();
        expect(audioBufferCache.get(ids[64]!)).toBeDefined();
        await expect(audioBufferCache.garbageCollectByAge(-1)).resolves.toBe(0);
        await expect(audioBufferCache.garbageCollectBySize(0)).resolves.toBe(0);
        expect(audioBufferCache.get(ids[0]!)).toBeDefined();
        expect(audioBufferCache.get(ids[64]!)).toBeDefined();

        const emptyProject = audioBufferCache.importBuffers({ context, buffers: {}, cacheIds: [] });
        await expect(emptyProject?.persist()).resolves.toBe(true);
        emptyProject?.publish();

        expect(audioBufferCache.get(ids[1]!)).toBeUndefined();
        expect(audioBufferCache.get(ids[64]!)).toBeDefined();
    });
});
