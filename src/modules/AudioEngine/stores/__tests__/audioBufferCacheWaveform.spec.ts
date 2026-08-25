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

function installFakeIndexedDb(): FakeBacking {
    const backing = new Map<string, StoredAudioBuffer>() as FakeBacking;
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
            delete: (key: Key) => {
                table.delete(key);
            },
            get: (key: Key) => {
                const request = {
                    result: undefined as Value | undefined,
                    error: null,
                    onsuccess: null as (() => void) | null,
                    onerror: null as (() => void) | null,
                };
                queueMicrotask(() => {
                    request.result = table.get(key);
                    request.onsuccess?.();
                });
                return request;
            },
            getAll: () => {
                const request = {
                    result: [] as Value[],
                    error: null,
                    onsuccess: null as (() => void) | null,
                    onerror: null as (() => void) | null,
                };
                queueMicrotask(() => {
                    request.result = [...table.values()];
                    request.onsuccess?.();
                });
                return request;
            },
            getAllKeys: () => {
                const request = {
                    result: [] as Key[],
                    error: null,
                    onsuccess: null as (() => void) | null,
                    onerror: null as (() => void) | null,
                };
                queueMicrotask(() => {
                    request.result = [...table.keys()];
                    request.onsuccess?.();
                });
                return request;
            },
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

describe('audioBufferCache waveform peaks', () => {
    afterEach(() => {
        audioBufferCache.clear();
        vi.unstubAllGlobals();
    });

    it('returns an empty array when numBins <= 0', () => {
        audioBufferCache.set('buf', createAudioBuffer({ length: 4 }));
        expect(audioBufferCache.getWaveformPeaks('buf', 0)).toHaveLength(0);
        expect(audioBufferCache.getWaveformPeaks('buf', -3)).toHaveLength(0);
    });

    it('returns a zeroed peaks array when the buffer is not cached', () => {
        const peaks = audioBufferCache.getWaveformPeaks('missing', 4);
        expect(peaks).toHaveLength(4);
        expect(Array.from(peaks)).toEqual([0, 0, 0, 0]);
    });

    it('reduces a windowed region to per-bin max peaks via the direct (high-zoom) path', () => {
        // samplesPerBin < 256 → direct path. 8 samples, 4 bins → 2 samples/bin.
        audioBufferCache.set('buf', createAudioBuffer({ length: 8, fill: (i) => (i === 3 ? 0.9 : 0.1 * i) }));
        const peaks = audioBufferCache.getWaveformPeaks('buf', 4, { startSample: 0, endSample: 8 });
        expect(peaks).toHaveLength(4);
        // bin0 covers samples [0,2) → max(|0|, |0.1|) = 0.1
        expect(peaks[0]).toBeCloseTo(0.1, 6);
        // bin1 covers [2,4) → max(|0.2|, |0.9|) = 0.9
        expect(peaks[1]).toBeCloseTo(0.9, 6);
    });

    it('uses the mipmap level-1 path when samplesPerBin >= 256 and caches it', () => {
        // 1024 samples, 1 bin → 1024 samples/bin (>= 256) → mipmap path.
        // Peak sits at sample 512 (value 0.8); mipmap bin 2 (samples 512..767) holds it.
        audioBufferCache.set('buf', createAudioBuffer({ length: 1024, fill: (i) => (i === 512 ? 0.8 : 0.01) }));
        const peaks = audioBufferCache.getWaveformPeaks('buf', 1);
        expect(peaks[0]).toBeCloseTo(0.8, 6);
        // Second call returns the cached peaks (same values, no recompute).
        const cached = audioBufferCache.getWaveformPeaks('buf', 1);
        expect(cached[0]).toBeCloseTo(0.8, 6);
    });

    it('clamps the window to [0, totalSamples] and yields empty peaks when it collapses', () => {
        audioBufferCache.set('buf', createAudioBuffer({ length: 8, fill: () => 0.5 }));
        // endSample before startSample → window collapses to length 0 → empty peaks.
        const collapsed = audioBufferCache.getWaveformPeaks('buf', 4, { startSample: 6, endSample: 2 });
        expect(collapsed).toHaveLength(4);
        expect(Array.from(collapsed)).toEqual([0, 0, 0, 0]);
        // Out-of-range window is clamped to the buffer bounds (no NaN/Infinity).
        const clamped = audioBufferCache.getWaveformPeaks('buf', 2, { startSample: -10, endSample: 100 });
        expect(clamped).toHaveLength(2);
        expect(Number.isFinite(clamped[0])).toBe(true);
    });

    it('treats a single-sample bin as a point read rather than a range', () => {
        // samplesPerBin < 1 so start===end for some bins → point-read branch.
        audioBufferCache.set('buf', createAudioBuffer({ length: 4, fill: (i) => (i === 2 ? 0.7 : 0.1) }));
        const peaks = audioBufferCache.getWaveformPeaks('buf', 8);
        expect(peaks).toHaveLength(8);
        // The point read at sample 2 should surface 0.7 somewhere.
        expect(Math.max(...Array.from(peaks))).toBeCloseTo(0.7, 6);
    });
});

describe('audioBufferCache exportBuffers IDB fallback', () => {
    afterEach(() => {
        audioBufferCache.clear();
        vi.unstubAllGlobals();
    });

    it('falls back to IDB for ids evicted from the in-memory cache', async () => {
        const backing = installFakeIndexedDb();
        backing.set('archived', {
            sampleRate: 48_000,
            numberOfChannels: 1,
            channelData: [new Float32Array([0.4, -0.4])],
            lastAccessed: 1,
            sizeInBytes: 2 * Float32Array.BYTES_PER_ELEMENT,
        });
        const exported = await audioBufferCache.exportBuffers(['archived', 'absent']);
        // archived resolved from IDB; absent silently omitted.
        expect(exported.archived).toBeDefined();
        expect(exported.archived?.sampleRate).toBe(48_000);
        expect(exported.absent).toBeUndefined();
    });

    it('omits IDB entries whose channel data is empty', async () => {
        const backing = installFakeIndexedDb();
        backing.set('empty', {
            sampleRate: 48_000,
            numberOfChannels: 1,
            channelData: [new Float32Array(0)],
            lastAccessed: 1,
            sizeInBytes: 0,
        });
        const exported = await audioBufferCache.exportBuffers(['empty']);
        expect(exported.empty).toBeUndefined();
    });

    it('serializes resident in-memory buffers and skips IDB', async () => {
        installFakeIndexedDb();
        audioBufferCache.set('live', createAudioBuffer({ length: 2, fill: (i) => 0.3 * (i + 1) }));
        const exported = await audioBufferCache.exportBuffers(['live']);
        expect(exported.live).toBeDefined();
        expect(exported.live?.numberOfChannels).toBe(1);
    });
});

describe('audioBufferCache prepareFromIdb cancellation + getAllKeys', () => {
    afterEach(() => {
        audioBufferCache.clear();
        vi.unstubAllGlobals();
    });

    it('returns null when shouldContinue is false before opening the db', async () => {
        const open = vi.fn();
        vi.stubGlobal('indexedDB', { open });
        const context = { createBuffer: vi.fn() } as unknown as BaseAudioContext;
        const prepared = await audioBufferCache.prepareFromIdb({ context, shouldContinue: () => false });
        expect(prepared).toBeNull();
        expect(open).not.toHaveBeenCalled();
    });

    it('restores every buffer in the db via getAllKeys when ids is omitted', async () => {
        const backing = installFakeIndexedDb();
        backing.set('a', {
            sampleRate: 48_000,
            numberOfChannels: 1,
            channelData: [new Float32Array([0.1, 0.2])],
            lastAccessed: 1,
            sizeInBytes: 2 * Float32Array.BYTES_PER_ELEMENT,
        });
        const context = {
            createBuffer: vi.fn((ch: number, len: number) => createAudioBuffer({ length: len, channels: ch })),
        } as unknown as BaseAudioContext;
        const count = await audioBufferCache.restoreFromIdb({ context });
        expect(count).toBe(1);
        expect(audioBufferCache.get('a')).toBeDefined();
    });

    it('skips a corrupt IDB entry whose channel lengths disagree', async () => {
        const backing = installFakeIndexedDb();
        backing.set('bad', {
            sampleRate: 48_000,
            numberOfChannels: 2,
            channelData: [new Float32Array([0.1, 0.2]), new Float32Array([0.3])],
            lastAccessed: 1,
            sizeInBytes: 0,
        });
        const context = {
            createBuffer: vi.fn(() => createAudioBuffer({ length: 1 })),
        } as unknown as BaseAudioContext;
        const count = await audioBufferCache.restoreFromIdb({ context, ids: ['bad'] });
        expect(count).toBe(0);
        expect(audioBufferCache.get('bad')).toBeUndefined();
    });

    it('publishes zero buffers (but still pins ids) when the read throws mid-stream', async () => {
        // A store.get that rejects to trigger the catch arm with an ids list.
        const recoveryStore = {
            get: () => {
                const request = {
                    result: undefined as unknown,
                    error: null,
                    onsuccess: null as (() => void) | null,
                    onerror: null as (() => void) | null,
                };
                queueMicrotask(() => {
                    request.result = { kind: 'prepared-audio-recovery-migration', schemaVersion: 1 };
                    request.onsuccess?.();
                });
                return request;
            },
        };
        const objectStore = {
            get: () => {
                const request = {
                    result: undefined,
                    error: null,
                    onsuccess: null as (() => void) | null,
                    onerror: null as (() => void) | null,
                };
                queueMicrotask(() => request.onerror?.());
                return request;
            },
            getAllKeys: () => {
                const request = {
                    result: [] as string[],
                    error: null,
                    onsuccess: null as (() => void) | null,
                    onerror: null as (() => void) | null,
                };
                queueMicrotask(() => request.onsuccess?.());
                return request;
            },
        };
        const database = {
            close: vi.fn(),
            objectStoreNames: { contains: () => true },
            createObjectStore: () => objectStore,
            transaction: (storeNames: string | string[]) => {
                const transaction = {
                    error: null,
                    onabort: null as (() => void) | null,
                    oncomplete: null as (() => void) | null,
                    onerror: null as (() => void) | null,
                    objectStore: () => (storeNames === 'preparedBufferRecovery' ? recoveryStore : objectStore),
                };
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
        const context = { createBuffer: vi.fn() } as unknown as BaseAudioContext;
        const prepared = await audioBufferCache.prepareFromIdb({ context, ids: ['x'] });
        // The catch arm still returns a publishable object that pins the ids.
        expect(prepared).not.toBeNull();
        expect(prepared!.publish()).toBe(0);
    });
});

describe('audioBufferCache garbage collection', () => {
    afterEach(() => {
        audioBufferCache.clear();
        vi.unstubAllGlobals();
    });

    it('deletes aged-out buffers from IDB and memory, skipping pinned ids', async () => {
        const backing = installFakeIndexedDb();
        backing.set('old', {
            sampleRate: 48_000,
            numberOfChannels: 1,
            channelData: [new Float32Array([0.1])],
            lastAccessed: 0,
            sizeInBytes: 4,
        });
        backing.meta.set('old', { lastAccessed: 0, sizeInBytes: 4 });
        // Pin 'live' so it survives both age and size sweeps.
        audioBufferCache.set('live', createAudioBuffer({ length: 1 }));
        backing.set('live', {
            sampleRate: 48_000,
            numberOfChannels: 1,
            channelData: [new Float32Array([0.2])],
            lastAccessed: Date.now(),
            sizeInBytes: 4,
        });
        backing.meta.set('live', { lastAccessed: Date.now(), sizeInBytes: 4 });

        const removed = await audioBufferCache.garbageCollectByAge(1);
        expect(removed).toBe(1);
        expect(audioBufferCache.get('live')).toBeDefined();
    });

    it('evicts the largest oldest buffers until total size fits, skipping pinned ids', async () => {
        const backing = installFakeIndexedDb();
        const now = Date.now();
        backing.set('big', {
            sampleRate: 48_000,
            numberOfChannels: 1,
            channelData: [new Float32Array(4)],
            lastAccessed: now - 1000,
            sizeInBytes: 16,
        });
        backing.meta.set('big', { lastAccessed: now - 1000, sizeInBytes: 16 });
        backing.set('small', {
            sampleRate: 48_000,
            numberOfChannels: 1,
            channelData: [new Float32Array(1)],
            lastAccessed: now,
            sizeInBytes: 4,
        });
        backing.meta.set('small', { lastAccessed: now, sizeInBytes: 4 });
        audioBufferCache.set('small', createAudioBuffer({ length: 1 }));

        const removed = await audioBufferCache.garbageCollectBySize(4);
        // 'big' (16 bytes, older) is evicted to bring total <= 4; 'small' pinned.
        expect(removed).toBeGreaterThanOrEqual(1);
        expect(audioBufferCache.get('small')).toBeDefined();
    });

    it('drops orphaned freeze-* buffers not in the active set', async () => {
        const backing = installFakeIndexedDb();
        backing.set('freeze-project-200-track-stale-1', {
            sampleRate: 48_000,
            numberOfChannels: 1,
            channelData: [new Float32Array([0.1])],
            lastAccessed: 1,
            sizeInBytes: 4,
        });
        audioBufferCache.set('freeze-project-200-track-stale-1', createAudioBuffer({ length: 1 }), {
            freezeProjectId: 200,
        });
        audioBufferCache.set('freeze-project-200-track-kept-2', createAudioBuffer({ length: 1 }), {
            freezeProjectId: 200,
        });

        await audioBufferCache.garbageCollectFreezeFiles({
            activeIds: new Set(['freeze-project-200-track-kept-2']),
            projectId: 200,
        });
        expect(audioBufferCache.get('freeze-project-200-track-stale-1')).toBeUndefined();
        expect(audioBufferCache.get('freeze-project-200-track-kept-2')).toBeDefined();
    });
});

describe('audioBufferCache exportBuffers encoding', () => {
    afterEach(() => {
        audioBufferCache.clear();
        vi.unstubAllGlobals();
    });

    function decodeChannel(b64: string): Float32Array {
        const binary = atob(b64);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index++) {
            bytes[index] = binary.charCodeAt(index);
        }
        return new Float32Array(bytes.buffer);
    }

    it('chunks large buffers and yields to the main thread mid-encode', async () => {
        // >256KB (32 chunks of 8KB) exercises the YIELD_EVERY await branch.
        installFakeIndexedDb();
        const big = createAudioBuffer({ length: 70000, fill: (index) => Math.sin(index) });
        audioBufferCache.set('big', big);

        const exported = await audioBufferCache.exportBuffers(['big']);

        const decoded = decodeChannel(exported.big!.channelData[0]!);
        expect(decoded.length).toBe(70000);
        // Samples on both sides of every yield boundary survive the chunking.
        expect(decoded[0]).toBeCloseTo(Math.sin(0), 6);
        expect(decoded[2047]).toBeCloseTo(Math.sin(2047), 6);
        expect(decoded[2048]).toBeCloseTo(Math.sin(2048), 6);
        expect(decoded[69_999]).toBeCloseTo(Math.sin(69_999), 6);
    });
});
