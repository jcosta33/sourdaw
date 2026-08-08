import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

// Loaded fresh per test. The cache holds one IndexedDB connection for the life
// of the module (audit M-045), and these tests install a new `indexedDB` double
// per test — without the reset, every test after the first would keep talking to
// the first test's double through the memoized connection.
let audioBufferCache: typeof import('../audioBufferCache').audioBufferCache;

beforeEach(async () => {
    vi.resetModules();
    ({ audioBufferCache } = await import('../audioBufferCache'));
});

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

function createTestContext(createBuffer: BaseAudioContext['createBuffer']): BaseAudioContext {
    const unsupported = (member: string): never => {
        throw new Error(`BaseAudioContext.${member} is not implemented in this test double`);
    };
    return {
        createBuffer,
        currentTime: 0,
        onstatechange: null,
        sampleRate: 48_000,
        state: 'running',
        get audioWorklet(): AudioWorklet {
            return unsupported('audioWorklet');
        },
        get destination(): AudioDestinationNode {
            return unsupported('destination');
        },
        get listener(): AudioListener {
            return unsupported('listener');
        },
        createAnalyser: () => unsupported('createAnalyser'),
        createBiquadFilter: () => unsupported('createBiquadFilter'),
        createBufferSource: () => unsupported('createBufferSource'),
        createChannelMerger: () => unsupported('createChannelMerger'),
        createChannelSplitter: () => unsupported('createChannelSplitter'),
        createConstantSource: () => unsupported('createConstantSource'),
        createConvolver: () => unsupported('createConvolver'),
        createDelay: () => unsupported('createDelay'),
        createDynamicsCompressor: () => unsupported('createDynamicsCompressor'),
        createGain: () => unsupported('createGain'),
        createIIRFilter: () => unsupported('createIIRFilter'),
        createOscillator: () => unsupported('createOscillator'),
        createPanner: () => unsupported('createPanner'),
        createPeriodicWave: () => unsupported('createPeriodicWave'),
        createScriptProcessor: () => unsupported('createScriptProcessor'),
        createStereoPanner: () => unsupported('createStereoPanner'),
        createWaveShaper: () => unsupported('createWaveShaper'),
        decodeAudioData: () => unsupported('decodeAudioData'),
        addEventListener: () => unsupported('addEventListener'),
        removeEventListener: () => unsupported('removeEventListener'),
        dispatchEvent: () => unsupported('dispatchEvent'),
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

type StoredAudioBuffer = {
    sampleRate: number;
    numberOfChannels: number;
    channelData: Float32Array[];
    lastAccessed: number;
    sizeInBytes: number;
};

function installFakeIndexedDb(): Map<string, StoredAudioBuffer> {
    const backing = new Map<string, StoredAudioBuffer>();
    // The database has two object stores from DB_VERSION 2 on, and they share a
    // key space. A double that handed the same map to both would let the
    // metadata row overwrite the record it describes.
    const metaBacking = new Map<string, { lastAccessed: number; sizeInBytes: number }>();

    function makeStore<Value>(table: Map<string, Value>) {
        return {
            clear: () => table.clear(),
            delete: (key: string) => table.delete(key),
            get: (key: string) => {
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
            getAllKeys: () => {
                const request = {
                    result: [] as string[],
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
            put: (value: Value, key: string) => {
                table.set(key, value);
            },
        };
    }

    const bufferStore = makeStore(backing);
    const metaStore = makeStore(metaBacking);
    function storeFor(name: string) {
        if (name === 'bufferMeta') {
            return metaStore;
        }
        return bufferStore;
    }

    const database = {
        objectStoreNames: { contains: () => true },
        createObjectStore: () => bufferStore,
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

// Test the pure conversion functions by importing them indirectly
// since they're not exported. We test them through the module's
// public API where possible, or test the pattern directly.

describe('audioBufferCache conversions', () => {
    afterEach(() => {
        audioBufferCache.clear();
        vi.unstubAllGlobals();
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
        const context = createTestContext(
            vi.fn((numberOfChannels: number, length: number, sampleRate: number) => {
                expect(numberOfChannels).toBe(1);
                return createAudioBuffer({ length, sampleRate });
            })
        );
        const first = { sampleRate: 48_000, numberOfChannels: 1, channelData: [encodeFloat32([0.25])] };
        const second = { sampleRate: 48_000, numberOfChannels: 1, channelData: [encodeFloat32([0.75])] };

        const firstCandidate = audioBufferCache.importBuffers({ context, buffers: { shared: first } });
        expect(audioBufferCache.get('shared')).toBeUndefined();
        firstCandidate?.publish();
        await expect(firstCandidate?.persist()).resolves.toBe(true);

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
        unavailableNonresidentCandidate?.publish();
        await expect(unavailableNonresidentCandidate?.persist()).resolves.toBe(false);

        const secondCandidate = audioBufferCache.importBuffers({ context, buffers: { shared: second } });
        secondCandidate?.publish();
        await expect(secondCandidate?.persist()).resolves.toBe(true);
        expect(audioBufferCache.get('shared')?.getChannelData(0)[0]).toBeCloseTo(0.75);
        expect(audioBufferCache.get('archived')).toBeUndefined();
    });

    it('rejects exported buffers with invalid header fields or mismatched channel lengths', () => {
        const context = createTestContext(
            vi.fn((_numberOfChannels: number, length: number, sampleRate: number) =>
                createAudioBuffer({ length, sampleRate })
            )
        );

        // Invalid sampleRate (non-finite / <= 0) → rejected.
        expect(
            audioBufferCache.importBuffers({
                context,
                buffers: {
                    a: { sampleRate: Number.NaN, numberOfChannels: 1, channelData: [encodeFloat32([0.1])] },
                },
            })
        ).toBeNull();
        expect(
            audioBufferCache.importBuffers({
                context,
                buffers: {
                    a: { sampleRate: 0, numberOfChannels: 1, channelData: [encodeFloat32([0.1])] },
                },
            })
        ).toBeNull();

        // channelData length !== numberOfChannels → rejected.
        expect(
            audioBufferCache.importBuffers({
                context,
                buffers: {
                    a: { sampleRate: 48_000, numberOfChannels: 2, channelData: [encodeFloat32([0.1])] },
                },
            })
        ).toBeNull();

        // A valid 2-channel buffer with unequal channel lengths → rejected by
        // the byte-length-equality check inside isValidExportedAudioBuffer.
        const longB64 = encodeFloat32([0.1, 0.2]);
        const shortB64 = encodeFloat32([0.3]);
        expect(
            audioBufferCache.importBuffers({
                context,
                buffers: {
                    a: { sampleRate: 48_000, numberOfChannels: 2, channelData: [longB64, shortB64] },
                },
            })
        ).toBeNull();
    });

    it('preserves a colliding durable buffer until the replacement candidate is published', async () => {
        const backing = installFakeIndexedDb();
        backing.set('shared', {
            sampleRate: 48_000,
            numberOfChannels: 1,
            channelData: [new Float32Array([0.25])],
            lastAccessed: 1,
            sizeInBytes: Float32Array.BYTES_PER_ELEMENT,
        });
        const context = createTestContext(
            vi.fn((_numberOfChannels: number, length: number, sampleRate: number) =>
                createAudioBuffer({ length, sampleRate })
            )
        );
        const restored = await audioBufferCache.prepareFromIdb({ context, ids: ['shared'] });
        restored?.publish();
        const candidate = audioBufferCache.importBuffers({
            context,
            buffers: {
                shared: { sampleRate: 48_000, numberOfChannels: 1, channelData: [encodeFloat32([0.75])] },
            },
            cacheIds: ['shared'],
        });

        await expect(candidate?.persist()).resolves.toBe(false);

        expect(backing.get('shared')?.channelData[0]?.[0]).toBeCloseTo(0.25);
        expect(audioBufferCache.get('shared')?.getChannelData(0)[0]).toBeCloseTo(0.25);

        candidate?.publish();
        await expect(candidate?.persist()).resolves.toBe(true);

        expect(backing.get('shared')?.channelData[0]?.[0]).toBeCloseTo(0.75);
        expect(audioBufferCache.get('shared')?.getChannelData(0)[0]).toBeCloseTo(0.75);
    });

    it('aborts and invalidates import persistence when replacement starts', async () => {
        type ControlledTransaction = {
            abort: ReturnType<typeof vi.fn>;
            error: Error | null;
            objectStore: () => { put: ReturnType<typeof vi.fn> };
            onabort: (() => void) | null;
            oncomplete: (() => void) | null;
            onerror: (() => void) | null;
        };
        const transactions: ControlledTransaction[] = [];
        const put = vi.fn();
        const database = {
            objectStoreNames: { contains: () => true },
            transaction: () => {
                const transaction: ControlledTransaction = {
                    abort: vi.fn(() => queueMicrotask(() => transaction.onabort?.())),
                    error: null,
                    objectStore: () => ({ put }),
                    onabort: null,
                    oncomplete: null,
                    onerror: null,
                };
                transactions.push(transaction);
                if (transactions.length > 1) {
                    queueMicrotask(() => transaction.oncomplete?.());
                }
                return transaction;
            },
        };
        vi.stubGlobal('indexedDB', {
            open: () => {
                const request = {
                    error: null,
                    onerror: null as (() => void) | null,
                    onsuccess: null as (() => void) | null,
                    onupgradeneeded: null as (() => void) | null,
                    result: database,
                };
                queueMicrotask(() => request.onsuccess?.());
                return request;
            },
        });
        const context = createTestContext(
            vi.fn((_numberOfChannels: number, length: number, sampleRate: number) =>
                createAudioBuffer({ length, sampleRate })
            )
        );
        const first = audioBufferCache.importBuffers({
            context,
            buffers: {
                shared: { sampleRate: 48_000, numberOfChannels: 1, channelData: [encodeFloat32([0.25])] },
            },
        });
        first?.publish();
        const firstPersistence = first?.persist();
        await vi.waitFor(() => expect(transactions).toHaveLength(1));

        audioBufferCache.cancelPendingImport();

        const firstTransaction = transactions[0]!;
        if (firstTransaction.abort.mock.calls.length === 0) {
            firstTransaction.oncomplete?.();
        }
        await expect(firstPersistence).resolves.toBe(false);

        expect(firstTransaction.abort).toHaveBeenCalledOnce();
        await expect(first?.persist()).resolves.toBe(false);
        expect(transactions).toHaveLength(1);
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

            // One memoized connection (audit M-045): both operations wait on
            // the same open request rather than racing two of them.
            expect(requests).toHaveLength(1);

            // Resolving it releases both continuations in the order they were
            // registered — the stale remove first, then the newer persist. The
            // remove must recognise that `set` has since claimed a newer
            // persistence generation for 'race' and skip its delete, which is
            // now the only thing keeping the buffer alive: it can no longer be
            // saved by the test resolving the opens in a convenient order.
            requests[0]!.onsuccess?.();
            await new Promise<void>((resolve) => setTimeout(resolve, 0));

            expect(store.put).toHaveBeenCalledWith(expect.anything(), 'race');
            expect(store.delete).not.toHaveBeenCalled();
            expect(transactions).toHaveLength(1);

            // And it stays skipped once the persist's transaction commits —
            // the remove is abandoned, not merely deferred behind the put.
            transactions[0]!.oncomplete?.();
            await new Promise<void>((resolve) => setTimeout(resolve, 0));

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
        prepared?.publish();
        await expect(prepared?.persist()).resolves.toBe(true);

        expect(audioBufferCache.get(ids[0]!)).toBeDefined();
        expect(audioBufferCache.get(ids[64]!)).toBeDefined();
        await expect(audioBufferCache.garbageCollectByAge(-1)).resolves.toBe(0);
        await expect(audioBufferCache.garbageCollectBySize(0)).resolves.toBe(0);
        expect(audioBufferCache.get(ids[0]!)).toBeDefined();
        expect(audioBufferCache.get(ids[64]!)).toBeDefined();

        const emptyProject = audioBufferCache.importBuffers({ context, buffers: {}, cacheIds: [] });
        emptyProject?.publish();
        await expect(emptyProject?.persist()).resolves.toBe(true);

        expect(audioBufferCache.get(ids[1]!)).toBeUndefined();
        expect(audioBufferCache.get(ids[64]!)).toBeDefined();
    });
});
