import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Loaded fresh per test. The cache holds one IndexedDB connection for the life
// of the module (audit M-045), and these tests install a new `indexedDB` double
// per test — without the reset, every test after the first would keep talking to
// the first test's double through the memoized connection.
let audioBufferCache: typeof import('../audioBufferCache').audioBufferCache;

beforeEach(async () => {
    vi.resetModules();
    ({ audioBufferCache } = await import('../audioBufferCache'));
});

/** Minimal AudioBuffer double backed by real Float32 channel data. */
function createAudioBuffer({
    length,
    sampleRate = 48_000,
    channels = 1,
    fill,
}: {
    length: number;
    sampleRate?: number;
    channels?: number;
    fill?: (index: number, channel: number) => number;
}): AudioBuffer {
    const data = Array.from({ length: channels }, (_, channel) => {
        const channelData = new Float32Array(length);
        if (fill) {
            for (let index = 0; index < length; index++) {
                channelData[index] = fill(index, channel);
            }
        }
        return channelData;
    });
    return {
        copyFromChannel: (destination: Float32Array, channelNumber: number, startInChannel = 0) => {
            destination.set(data[channelNumber]!.subarray(startInChannel, startInChannel + destination.length));
        },
        copyToChannel: (source: Float32Array, channelNumber: number, startInChannel = 0) => {
            data[channelNumber]!.set(source, startInChannel);
        },
        duration: length / sampleRate,
        getChannelData: (channelNumber: number) => data[channelNumber]!,
        length,
        numberOfChannels: channels,
        sampleRate,
    };
}

type StoredAudioBuffer = {
    sampleRate: number;
    numberOfChannels: number;
    channelData: Float32Array[];
    lastAccessed: number;
    sizeInBytes: number;
};

type StoredBufferMeta = { lastAccessed: number; sizeInBytes: number };

/** The buffers store, with the metadata store hanging off it as `.meta`. A
 * spec that seeds a record directly has to seed its row too, because from
 * DB_VERSION 2 on a record with no row is deliberately not collectable. */
type FakeBacking = Map<string, StoredAudioBuffer> & { meta: Map<string, StoredBufferMeta> };

/** In-memory IndexedDB double covering the store operations the cache uses. */
function installFakeIndexedDb(): FakeBacking {
    const backing = new Map<string, StoredAudioBuffer>() as FakeBacking;
    type FakeRequest<Result> = {
        result: Result;
        error: null;
        onsuccess: (() => void) | null;
        onerror: (() => void) | null;
    };
    function asyncRequest<Result>(produce: () => Result): FakeRequest<Result> {
        const request: FakeRequest<Result> = {
            result: undefined as Result,
            error: null,
            onsuccess: null,
            onerror: null,
        };
        queueMicrotask(() => {
            request.result = produce();
            request.onsuccess?.();
        });
        return request;
    }
    // Two object stores from DB_VERSION 2 on, sharing a key space: the metadata
    // row and the record it describes must not land in the same map.
    const metaBacking = new Map<string, StoredBufferMeta>();
    const recoveryBacking = new Map<IDBValidKey, unknown>([
        [0, { kind: 'prepared-audio-recovery-migration', schemaVersion: 1 }],
    ]);
    backing.meta = metaBacking;
    function makeStore<Key, Value>(table: Map<Key, Value>) {
        return {
            clear: () => table.clear(),
            delete: (key: Key) => table.delete(key),
            get: (key: Key) => asyncRequest(() => table.get(key)),
            getAll: () => asyncRequest(() => [...table.values()]),
            getAllKeys: () => asyncRequest(() => [...table.keys()]),
            put: (value: Value, key: Key) => {
                table.set(key, value);
            },
        };
    }
    const objectStore = makeStore(backing);
    const metaStore = makeStore(metaBacking);
    const recoveryStore = makeStore(recoveryBacking);
    function storeFor(name: string) {
        if (name === 'bufferMeta') {
            return metaStore;
        }
        if (name === 'preparedBufferRecovery') {
            return recoveryStore;
        }
        return objectStore;
    }
    const database = {
        close: vi.fn(),
        objectStoreNames: { contains: () => true },
        createObjectStore: () => objectStore,
        transaction: () => {
            const transaction = {
                error: null,
                onabort: null as (() => void) | null,
                oncomplete: null as (() => void) | null,
                onerror: null as (() => void) | null,
                abort: vi.fn(),
                objectStore: (name: string) => storeFor(name),
            };
            // `complete` fires only after every queued request has been
            // delivered (IDB 3.0 §5.6). Requests here resolve on microtasks, so
            // the commit has to be a task or it would outrun them.
            setTimeout(() => transaction.oncomplete?.(), 0);
            return transaction;
        },
    };
    vi.stubGlobal('indexedDB', {
        open: () => {
            const request = {
                result: database,
                error: null,
                onsuccess: null as (() => void) | null,
                onerror: null as (() => void) | null,
                onupgradeneeded: null as (() => void) | null,
            };
            queueMicrotask(() => request.onsuccess?.());
            return request;
        },
    });
    return backing;
}

/** Flush the fake IDB microtasks queued by fire-and-forget persistence. */
async function settle(): Promise<void> {
    for (let round = 0; round < 8; round++) {
        await Promise.resolve();
    }
}

const MAX_ENTRIES = 64;

describe('audioBufferCache lifecycle', () => {
    afterEach(async () => {
        audioBufferCache.clear();
        await settle();
        vi.unstubAllGlobals();
    });

    describe('lookup and removal', () => {
        it('stores, reports, returns, and removes a buffer', () => {
            installFakeIndexedDb();
            const buffer = createAudioBuffer({ length: 4, fill: () => 0.5 });

            expect(audioBufferCache.has('clip-a')).toBe(false);
            expect(audioBufferCache.get('clip-a')).toBeUndefined();

            audioBufferCache.set('clip-a', buffer);
            expect(audioBufferCache.has('clip-a')).toBe(true);
            expect(audioBufferCache.get('clip-a')).toBe(buffer);

            audioBufferCache.remove('clip-a');
            expect(audioBufferCache.has('clip-a')).toBe(false);
            expect(audioBufferCache.get('clip-a')).toBeUndefined();
        });
    });

    describe('LRU eviction', () => {
        it('evicts the least-recently-used unpinned entry once the cap is exceeded', () => {
            installFakeIndexedDb();
            for (let index = 0; index < MAX_ENTRIES; index++) {
                audioBufferCache.set(`b${index}`, createAudioBuffer({ length: 1 }));
            }
            expect(audioBufferCache.has('b0')).toBe(true);

            audioBufferCache.set(`b${MAX_ENTRIES}`, createAudioBuffer({ length: 1 }));

            expect(audioBufferCache.has('b0')).toBe(false);
            expect(audioBufferCache.has('b1')).toBe(true);
            expect(audioBufferCache.has(`b${MAX_ENTRIES}`)).toBe(true);
        });

        it('promotes an entry to most-recently-used on get so it survives the next eviction', () => {
            installFakeIndexedDb();
            for (let index = 0; index < MAX_ENTRIES; index++) {
                audioBufferCache.set(`b${index}`, createAudioBuffer({ length: 1 }));
            }

            // b0 would be next out; reading it promotes it past b1.
            expect(audioBufferCache.get('b0')).toBeDefined();
            audioBufferCache.set('newcomer', createAudioBuffer({ length: 1 }));

            expect(audioBufferCache.has('b0')).toBe(true);
            expect(audioBufferCache.has('b1')).toBe(false);
        });

        it('re-setting an existing id replaces the buffer without evicting anything', () => {
            installFakeIndexedDb();
            for (let index = 0; index < MAX_ENTRIES; index++) {
                audioBufferCache.set(`b${index}`, createAudioBuffer({ length: 1 }));
            }
            const replacement = createAudioBuffer({ length: 2 });

            audioBufferCache.set('b5', replacement);

            expect(audioBufferCache.get('b5')).toBe(replacement);
            for (let index = 0; index < MAX_ENTRIES; index++) {
                expect(audioBufferCache.has(`b${index}`), `b${index}`).toBe(true);
            }
        });
    });

    describe('getWaveformPeaks', () => {
        it('returns an empty array for a non-positive bin count', () => {
            installFakeIndexedDb();
            expect(audioBufferCache.getWaveformPeaks('missing', 0)).toHaveLength(0);
            expect(audioBufferCache.getWaveformPeaks('missing', -3)).toHaveLength(0);
        });

        it('returns silent bins for an unknown buffer id', () => {
            installFakeIndexedDb();
            const peaks = audioBufferCache.getWaveformPeaks('missing', 4);
            expect(Array.from(peaks)).toEqual([0, 0, 0, 0]);
        });

        it('computes per-bin absolute peaks straight from the samples at high zoom', () => {
            installFakeIndexedDb();
            const samples = [0.1, -0.9, 0.5, 0.2, -0.3, 0.7, 0.0, -0.05];
            audioBufferCache.set(
                'clip',
                createAudioBuffer({ length: samples.length, fill: (index) => samples[index]! })
            );

            const peaks = audioBufferCache.getWaveformPeaks('clip', 4);

            expect(Array.from(peaks).map((value) => Number(value.toFixed(4)))).toEqual([0.9, 0.5, 0.7, 0.05]);
        });

        it('honours the sample window so trimmed clips do not read the whole buffer', () => {
            installFakeIndexedDb();
            const samples = [0.9, 0.9, 0.1, 0.2, 0.3, 0.4, 0.9, 0.9];
            audioBufferCache.set(
                'clip',
                createAudioBuffer({ length: samples.length, fill: (index) => samples[index]! })
            );

            const peaks = audioBufferCache.getWaveformPeaks('clip', 2, { startSample: 2, endSample: 6 });

            expect(Array.from(peaks).map((value) => Number(value.toFixed(4)))).toEqual([0.2, 0.4]);
        });

        it('returns silent bins for an empty window', () => {
            installFakeIndexedDb();
            audioBufferCache.set('clip', createAudioBuffer({ length: 8, fill: () => 0.5 }));

            const peaks = audioBufferCache.getWaveformPeaks('clip', 3, { startSample: 4, endSample: 4 });

            expect(Array.from(peaks)).toEqual([0, 0, 0]);
        });

        it('serves repeated reads for the same window from the waveform cache', () => {
            installFakeIndexedDb();
            audioBufferCache.set('clip', createAudioBuffer({ length: 8, fill: (index) => index / 8 }));

            const first = audioBufferCache.getWaveformPeaks('clip', 4);
            const second = audioBufferCache.getWaveformPeaks('clip', 4);

            expect(second).toBe(first);
        });

        it('invalidates cached peaks when the buffer behind the id is replaced', () => {
            installFakeIndexedDb();
            audioBufferCache.set('clip', createAudioBuffer({ length: 4, fill: () => 0.25 }));
            const before = audioBufferCache.getWaveformPeaks('clip', 2);
            expect(Array.from(before)).toEqual([0.25, 0.25]);

            audioBufferCache.set('clip', createAudioBuffer({ length: 4, fill: () => 0.75 }));
            const after = audioBufferCache.getWaveformPeaks('clip', 2);

            expect(after).not.toBe(before);
            expect(Array.from(after)).toEqual([0.75, 0.75]);
        });

        it('uses the 256-sample mipmap for zoomed-out reads and reports block peaks', () => {
            installFakeIndexedDb();
            // 1024 samples / 4 bins = 256 samples per bin → mipmap path.
            audioBufferCache.set(
                'long',
                createAudioBuffer({
                    length: 1024,
                    fill: (index) => {
                        if (index === 100) {
                            return -0.8;
                        }
                        if (index === 600) {
                            return 0.4;
                        }
                        return 0;
                    },
                })
            );

            const peaks = audioBufferCache.getWaveformPeaks('long', 4);

            expect(Array.from(peaks).map((value) => Number(value.toFixed(4)))).toEqual([0.8, 0, 0.4, 0]);
        });

        it('reuses the cached mipmap on a second zoomed-out read over a partial window', () => {
            installFakeIndexedDb();
            audioBufferCache.set('long', createAudioBuffer({ length: 1024, fill: () => 0 }));

            // First read builds the mipmap; a windowed second read must reuse it
            // and exercise the mipmap single-sample-bin path (start === end).
            audioBufferCache.getWaveformPeaks('long', 4);
            // Many bins over a narrow window → mipmapSamplesPerBin < 1 → some
            // bins collapse to start === end (single mipmap sample).
            const peaks = audioBufferCache.getWaveformPeaks('long', 8, {
                startSample: 0,
                endSample: 256,
            });
            expect(peaks).toHaveLength(8);
        });

        it('computes a single-sample bin peak in the high-zoom path when samplesPerBin < 1', () => {
            installFakeIndexedDb();
            // 4 samples, 8 bins → samplesPerBin = 0.5 → several bins hit
            // start === end and read a single channel sample.
            audioBufferCache.set(
                'clip',
                createAudioBuffer({ length: 4, fill: (index) => [0.1, 0.6, -0.4, 0.2][index]! })
            );

            const peaks = audioBufferCache.getWaveformPeaks('clip', 8);

            expect(peaks).toHaveLength(8);
            // Each bin maps to at most one sample; the max absolute value
            // observed is 0.6.
            const max = Math.max(...Array.from(peaks));
            expect(max).toBeCloseTo(0.6, 6);
        });

        it('clamps a window whose start/end exceed the buffer length', () => {
            installFakeIndexedDb();
            audioBufferCache.set('clip', createAudioBuffer({ length: 8, fill: () => 0.5 }));

            // windowEnd beyond the buffer is clamped to totalSamples;
            // windowStart negative is clamped to 0.
            const peaks = audioBufferCache.getWaveformPeaks('clip', 2, {
                startSample: -5,
                endSample: 9999,
            });

            expect(Array.from(peaks)).toEqual([0.5, 0.5]);
        });
    });

    describe('serialization and export', () => {
        it('encodes every channel of a resident buffer as base64 Float32 PCM', async () => {
            installFakeIndexedDb();
            const buffer = createAudioBuffer({
                length: 3,
                channels: 2,
                fill: (index, channel) => (channel === 0 ? index * 0.25 : -index * 0.25),
            });
            audioBufferCache.set('stems', buffer);

            const exported = await audioBufferCache.exportBuffers(['stems']);

            expect(Object.keys(exported)).toEqual(['stems']);
            expect(exported.stems!.sampleRate).toBe(48_000);
            expect(exported.stems!.numberOfChannels).toBe(2);
            expect(exported.stems!.channelData).toHaveLength(2);
            const decodeChannel = (b64: string) => {
                const binary = atob(b64);
                const bytes = new Uint8Array(binary.length);
                for (let index = 0; index < binary.length; index++) {
                    bytes[index] = binary.charCodeAt(index);
                }
                return Array.from(new Float32Array(bytes.buffer));
            };
            expect(decodeChannel(exported.stems!.channelData[0]!)).toEqual([0, 0.25, 0.5]);
            expect(decodeChannel(exported.stems!.channelData[1]!)).toEqual([-0, -0.25, -0.5]);
        });

        it('exportBuffers serializes resident buffers, falls back to IDB for evicted ids, and omits unknowns', async () => {
            const backing = installFakeIndexedDb();
            backing.set('evicted', {
                sampleRate: 44_100,
                numberOfChannels: 1,
                channelData: [new Float32Array([0.5, -0.5])],
                lastAccessed: 1,
                sizeInBytes: 8,
            });
            audioBufferCache.set('resident', createAudioBuffer({ length: 2, fill: () => 0.25 }));

            const exported = await audioBufferCache.exportBuffers(['resident', 'evicted', 'ghost']);

            expect(Object.keys(exported).sort()).toEqual(['evicted', 'resident']);
            expect(exported.resident!.sampleRate).toBe(48_000);
            expect(exported.evicted!.sampleRate).toBe(44_100);
            const binary = atob(exported.evicted!.channelData[0]!);
            const bytes = new Uint8Array(binary.length);
            for (let index = 0; index < binary.length; index++) {
                bytes[index] = binary.charCodeAt(index);
            }
            expect(Array.from(new Float32Array(bytes.buffer))).toEqual([0.5, -0.5]);
        });
    });

    describe('restoreFromIdb', () => {
        function makeRestoreContext(): Pick<BaseAudioContext, 'createBuffer'> {
            return {
                createBuffer: (channels: number, length: number, sampleRate: number) =>
                    createAudioBuffer({ length, sampleRate, channels }),
            };
        }

        it('rehydrates durable buffers into the cache and reports how many were published', async () => {
            const backing = installFakeIndexedDb();
            backing.set('a', {
                sampleRate: 48_000,
                numberOfChannels: 1,
                channelData: [new Float32Array([0.25, 0.5])],
                lastAccessed: 1,
                sizeInBytes: 8,
            });
            backing.set('b', {
                sampleRate: 48_000,
                numberOfChannels: 1,
                channelData: [new Float32Array([0.75])],
                lastAccessed: 1,
                sizeInBytes: 4,
            });

            const restored = await audioBufferCache.restoreFromIdb({ context: makeRestoreContext() });

            expect(restored).toBe(2);
            expect(Array.from(audioBufferCache.get('a')!.getChannelData(0))).toEqual([0.25, 0.5]);
            expect(Array.from(audioBufferCache.get('b')!.getChannelData(0))).toEqual([0.75]);
        });

        it('skips corrupt durable entries whose channel data does not match the declared shape', async () => {
            const backing = installFakeIndexedDb();
            backing.set('corrupt', {
                sampleRate: 48_000,
                numberOfChannels: 2,
                channelData: [new Float32Array([0.25])],
                lastAccessed: 1,
                sizeInBytes: 4,
            });
            backing.set('sound', {
                sampleRate: 48_000,
                numberOfChannels: 1,
                channelData: [new Float32Array([0.5])],
                lastAccessed: 1,
                sizeInBytes: 4,
            });

            const restored = await audioBufferCache.restoreFromIdb({ context: makeRestoreContext() });

            expect(restored).toBe(1);
            expect(audioBufferCache.has('corrupt')).toBe(false);
            expect(audioBufferCache.has('sound')).toBe(true);
        });

        it('publishes nothing when the caller cancels via shouldContinue', async () => {
            const backing = installFakeIndexedDb();
            backing.set('a', {
                sampleRate: 48_000,
                numberOfChannels: 1,
                channelData: [new Float32Array([0.25])],
                lastAccessed: 1,
                sizeInBytes: 4,
            });

            const restored = await audioBufferCache.restoreFromIdb({
                context: makeRestoreContext(),
                shouldContinue: () => false,
            });

            expect(restored).toBe(0);
            expect(audioBufferCache.has('a')).toBe(false);
        });
    });

    describe('garbage collection', () => {
        it('drops inactive freeze buffers from memory while keeping active and non-freeze entries', async () => {
            installFakeIndexedDb();
            audioBufferCache.set('freeze-project-200-track-old-1', createAudioBuffer({ length: 1 }), {
                freezeProjectId: 200,
            });
            audioBufferCache.set('freeze-project-200-track-active-2', createAudioBuffer({ length: 1 }), {
                freezeProjectId: 200,
            });
            audioBufferCache.set('clip-normal', createAudioBuffer({ length: 1 }));

            await audioBufferCache.garbageCollectFreezeFiles({
                activeIds: new Set(['freeze-project-200-track-active-2']),
                projectId: 200,
            });

            expect(audioBufferCache.has('freeze-project-200-track-old-1')).toBe(false);
            expect(audioBufferCache.has('freeze-project-200-track-active-2')).toBe(true);
            expect(audioBufferCache.has('clip-normal')).toBe(true);
        });

        it('garbageCollectByAge deletes only durable entries older than the threshold', async () => {
            const backing = installFakeIndexedDb();
            backing.set('ancient', {
                sampleRate: 48_000,
                numberOfChannels: 1,
                channelData: [new Float32Array([0.1])],
                lastAccessed: 1,
                sizeInBytes: 4,
            });
            backing.meta.set('ancient', { lastAccessed: 1, sizeInBytes: 4 });
            backing.set('fresh', {
                sampleRate: 48_000,
                numberOfChannels: 1,
                channelData: [new Float32Array([0.2])],
                lastAccessed: Date.now(),
                sizeInBytes: 4,
            });
            backing.meta.set('fresh', { lastAccessed: Date.now(), sizeInBytes: 4 });

            const deleted = await audioBufferCache.garbageCollectByAge(1);

            expect(deleted).toBe(1);
            expect(backing.has('ancient')).toBe(false);
            expect(backing.has('fresh')).toBe(true);
        });

        it('garbageCollectBySize deletes oldest entries until the total fits the budget', async () => {
            const backing = installFakeIndexedDb();
            backing.set('oldest', {
                sampleRate: 48_000,
                numberOfChannels: 1,
                channelData: [new Float32Array([0.1])],
                lastAccessed: 10,
                sizeInBytes: 100,
            });
            backing.meta.set('oldest', { lastAccessed: 10, sizeInBytes: 100 });
            backing.set('middle', {
                sampleRate: 48_000,
                numberOfChannels: 1,
                channelData: [new Float32Array([0.2])],
                lastAccessed: 20,
                sizeInBytes: 100,
            });
            backing.meta.set('middle', { lastAccessed: 20, sizeInBytes: 100 });
            backing.set('newest', {
                sampleRate: 48_000,
                numberOfChannels: 1,
                channelData: [new Float32Array([0.3])],
                lastAccessed: 30,
                sizeInBytes: 100,
            });
            backing.meta.set('newest', { lastAccessed: 30, sizeInBytes: 100 });

            const deleted = await audioBufferCache.garbageCollectBySize(150);

            expect(deleted).toBe(2);
            expect(backing.has('oldest')).toBe(false);
            expect(backing.has('middle')).toBe(false);
            expect(backing.has('newest')).toBe(true);
        });

        it('garbageCollectBySize leaves everything in place when already under budget', async () => {
            const backing = installFakeIndexedDb();
            backing.set('only', {
                sampleRate: 48_000,
                numberOfChannels: 1,
                channelData: [new Float32Array([0.1])],
                lastAccessed: 10,
                sizeInBytes: 100,
            });

            const deleted = await audioBufferCache.garbageCollectBySize(1_000);

            expect(deleted).toBe(0);
            expect(backing.has('only')).toBe(true);
        });
    });
});
