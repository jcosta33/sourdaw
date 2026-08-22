import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

import { flushIndexedDbTasks, installFakeAudioIndexedDb } from './fakeAudioBufferIndexedDb';

// Loaded fresh per test. The cache holds one IndexedDB connection for the life
// of the module (audit M-045), and these tests install a new `indexedDB` double
// per test — without the reset, every test after the first would keep talking to
// the first test's double through the memoized connection.
let audioBufferCache: typeof import('../audioBufferCache').audioBufferCache;
let clearRuntimeAudioBufferCache: typeof import('../audioBufferCache').clearRuntimeAudioBufferCache;

beforeEach(async () => {
    vi.resetModules();
    ({ audioBufferCache, clearRuntimeAudioBufferCache } = await import('../audioBufferCache'));
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

type StoredBufferMeta = {
    lastAccessed: number;
    sizeInBytes: number;
    preparedOwner?: {
        schemaVersion: 1;
        leaseId: string;
        status: 'project-owned' | 'temporary';
    };
};

type FakeBacking = Map<string, StoredAudioBuffer> & { meta: Map<string, StoredBufferMeta> };

function installFakeIndexedDb(): FakeBacking {
    const backing = new Map<string, StoredAudioBuffer>() as FakeBacking;
    // The database has two object stores from DB_VERSION 2 on, and they share a
    // key space. A double that handed the same map to both would let the
    // metadata row overwrite the record it describes.
    const metaBacking = new Map<string, StoredBufferMeta>();
    backing.meta = metaBacking;

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

    it('reports prepared PCM durable only after commit and reopens the exact owner after reload', async () => {
        const backing = installFakeIndexedDb();
        const source = createAudioBuffer({ length: 2, sampleRate: 48_000 });
        source.getChannelData(0).set([0.25, -0.75]);
        let settled = false;

        const persistence = audioBufferCache
            .persistPreparedBuffer({ id: 'prepared-pcm', buffer: source })
            .then((result) => {
                settled = true;
                return result;
            });

        await Promise.resolve();
        expect(settled).toBe(false);
        expect(backing.has('prepared-pcm')).toBe(false);

        const persisted = await persistence;
        expect(persisted).toMatchObject({ status: 'persisted', bufferId: 'prepared-pcm' });
        if (persisted.status !== 'persisted') {
            throw new TypeError('Expected prepared PCM persistence to commit');
        }
        expect(Array.from(backing.get('prepared-pcm')?.channelData[0] ?? [])).toEqual([0.25, -0.75]);
        expect(backing.meta.get('prepared-pcm')?.preparedOwner).toEqual({
            schemaVersion: 1,
            leaseId: persisted.leaseId,
            status: 'temporary',
        });

        vi.resetModules();
        ({ audioBufferCache } = await import('../audioBufferCache'));
        const reopened = await audioBufferCache.reopenPreparedBuffer({
            id: 'prepared-pcm',
            leaseId: persisted.leaseId,
            context: createTestContext(
                vi.fn((_numberOfChannels: number, length: number, sampleRate: number) =>
                    createAudioBuffer({ length, sampleRate })
                )
            ),
        });

        expect(reopened).toEqual({ status: 'reopened', bufferId: 'prepared-pcm', ownership: 'temporary' });
        expect(Array.from(audioBufferCache.get('prepared-pcm')?.getChannelData(0) ?? [])).toEqual([0.25, -0.75]);
    });

    it('types prepared persistence failure and missing or mismatched reopen without claiming durability', async () => {
        vi.stubGlobal('indexedDB', {
            open: () => {
                const request = {
                    error: new Error('storage unavailable'),
                    onerror: null as (() => void) | null,
                    onsuccess: null as (() => void) | null,
                    onupgradeneeded: null as (() => void) | null,
                };
                queueMicrotask(() => request.onerror?.());
                return request;
            },
        });

        await expect(
            audioBufferCache.persistPreparedBuffer({
                id: 'failed-pcm',
                buffer: createAudioBuffer({ length: 1, sampleRate: 48_000 }),
            })
        ).resolves.toMatchObject({ status: 'failed', reason: 'storage unavailable' });

        vi.resetModules();
        ({ audioBufferCache } = await import('../audioBufferCache'));
        const aborted = installFakeAudioIndexedDb();
        aborted.abortWrites();
        await expect(
            audioBufferCache.persistPreparedBuffer({
                id: 'aborted-pcm',
                buffer: createAudioBuffer({ length: 1, sampleRate: 48_000 }),
            })
        ).resolves.toMatchObject({ status: 'failed', reason: 'IDB transaction aborted' });
        expect(aborted.committed.has('aborted-pcm')).toBe(false);

        vi.resetModules();
        ({ audioBufferCache } = await import('../audioBufferCache'));
        const backing = installFakeIndexedDb();
        backing.set('owned-pcm', {
            sampleRate: 48_000,
            numberOfChannels: 1,
            channelData: [new Float32Array([0.5])],
            lastAccessed: 1,
            sizeInBytes: 4,
        });
        backing.meta.set('owned-pcm', {
            lastAccessed: 1,
            sizeInBytes: 4,
            preparedOwner: { schemaVersion: 1, leaseId: 'lease-correct', status: 'temporary' },
        });
        const context = createTestContext(
            vi.fn((_numberOfChannels: number, length: number, sampleRate: number) =>
                createAudioBuffer({ length, sampleRate })
            )
        );

        await expect(
            audioBufferCache.reopenPreparedBuffer({ id: 'missing-pcm', leaseId: 'lease-missing', context })
        ).resolves.toEqual({ status: 'missing' });
        await expect(
            audioBufferCache.reopenPreparedBuffer({ id: 'owned-pcm', leaseId: 'lease-wrong', context })
        ).resolves.toEqual({ status: 'mismatched' });

        backing.get('owned-pcm')!.sizeInBytes = 8;
        await expect(
            audioBufferCache.reopenPreparedBuffer({ id: 'owned-pcm', leaseId: 'lease-correct', context })
        ).resolves.toEqual({ status: 'failed', reason: 'Prepared audio PCM is invalid.' });
    });

    it('settles temporary ownership once and never lets later discard delete project-owned PCM', async () => {
        const backing = installFakeIndexedDb();
        const retained = await audioBufferCache.persistPreparedBuffer({
            id: 'retained-pcm',
            buffer: createAudioBuffer({ length: 1, sampleRate: 48_000 }),
        });
        if (retained.status !== 'persisted') {
            throw new TypeError('Expected retained PCM persistence to commit');
        }

        await expect(
            audioBufferCache.releasePreparedBuffer({
                id: 'retained-pcm',
                leaseId: retained.leaseId,
                disposition: 'project-owned',
            })
        ).resolves.toEqual({ status: 'released', disposition: 'project-owned' });
        await expect(
            audioBufferCache.releasePreparedBuffer({
                id: 'retained-pcm',
                leaseId: retained.leaseId,
                disposition: 'discard',
            })
        ).resolves.toEqual({ status: 'already-settled', disposition: 'project-owned' });
        expect(backing.has('retained-pcm')).toBe(true);

        const discarded = await audioBufferCache.persistPreparedBuffer({
            id: 'discarded-pcm',
            buffer: createAudioBuffer({ length: 1, sampleRate: 48_000 }),
        });
        if (discarded.status !== 'persisted') {
            throw new TypeError('Expected discarded PCM persistence to commit');
        }
        await expect(audioBufferCache.garbageCollectByAge(-1)).resolves.toBe(0);
        await expect(audioBufferCache.garbageCollectBySize(0)).resolves.toBe(0);
        expect(backing.has('discarded-pcm')).toBe(true);
        await expect(
            audioBufferCache.releasePreparedBuffer({
                id: 'discarded-pcm',
                leaseId: discarded.leaseId,
                disposition: 'discard',
            })
        ).resolves.toEqual({ status: 'released', disposition: 'discarded' });
        await expect(
            audioBufferCache.releasePreparedBuffer({
                id: 'discarded-pcm',
                leaseId: discarded.leaseId,
                disposition: 'discard',
            })
        ).resolves.toEqual({ status: 'missing' });
        expect(backing.has('discarded-pcm')).toBe(false);
    });

    it('lets only the newest persistence generation claim prepared ownership for an exact buffer id', async () => {
        const backing = installFakeIndexedDb();
        const firstBuffer = createAudioBuffer({ length: 1, sampleRate: 48_000 });
        firstBuffer.getChannelData(0)[0] = 0.25;
        const secondBuffer = createAudioBuffer({ length: 1, sampleRate: 48_000 });
        secondBuffer.getChannelData(0)[0] = 0.75;

        const first = audioBufferCache.persistPreparedBuffer({ id: 'generation-pcm', buffer: firstBuffer });
        const second = audioBufferCache.persistPreparedBuffer({ id: 'generation-pcm', buffer: secondBuffer });

        await expect(first).resolves.toEqual({
            status: 'failed',
            reason: 'Prepared audio persistence was superseded.',
        });
        const secondResult = await second;
        expect(secondResult).toMatchObject({ status: 'persisted', bufferId: 'generation-pcm' });
        expect(backing.get('generation-pcm')?.channelData[0]?.[0]).toBeCloseTo(0.75);
        expect(backing.meta.get('generation-pcm')?.preparedOwner?.leaseId).toBe(
            secondResult.status === 'persisted' ? secondResult.leaseId : undefined
        );
    });

    it('rejects occupied legacy and project-owned ids without changing runtime PCM or either durable row', async () => {
        const controls = installFakeAudioIndexedDb();
        const legacy = createAudioBuffer({ length: 1, sampleRate: 48_000 });
        legacy.getChannelData(0)[0] = 0.2;
        audioBufferCache.set('legacy-collision', legacy);
        await flushIndexedDbTasks();

        const project = createAudioBuffer({ length: 1, sampleRate: 48_000 });
        project.getChannelData(0)[0] = 0.4;
        const stagedProject = await audioBufferCache.persistPreparedBuffer({
            id: 'project-collision',
            buffer: project,
        });
        if (stagedProject.status !== 'persisted') {
            throw new TypeError('Expected project collision fixture to persist');
        }
        await audioBufferCache.releasePreparedBuffer({
            id: 'project-collision',
            leaseId: stagedProject.leaseId,
            disposition: 'project-owned',
        });

        for (const [id, original] of [
            ['legacy-collision', legacy],
            ['project-collision', project],
        ] as const) {
            const durablePcm = structuredClone(controls.committed.get(id));
            const durableMeta = structuredClone(controls.committedMeta.get(id));
            const replacement = createAudioBuffer({ length: 1, sampleRate: 48_000 });
            replacement.getChannelData(0)[0] = 0.9;

            await expect(audioBufferCache.persistPreparedBuffer({ id, buffer: replacement })).resolves.toEqual({
                status: 'failed',
                reason: 'Prepared audio buffer ID is already occupied.',
            });
            expect(audioBufferCache.get(id)).toBe(original);
            expect(controls.committed.get(id)).toEqual(durablePcm);
            expect(controls.committedMeta.get(id)).toEqual(durableMeta);
        }
    });

    it('does not let immediate prepared persistence supersede an occupied ordinary set', async () => {
        const controls = installFakeAudioIndexedDb();
        const projectBuffer = createAudioBuffer({ length: 1, sampleRate: 48_000 });
        projectBuffer.getChannelData(0)[0] = 0.15;
        audioBufferCache.set('ordinary-set-collision', projectBuffer);
        const prepared = createAudioBuffer({ length: 1, sampleRate: 48_000 });
        prepared.getChannelData(0)[0] = 0.95;

        await expect(
            audioBufferCache.persistPreparedBuffer({ id: 'ordinary-set-collision', buffer: prepared })
        ).resolves.toEqual({
            status: 'failed',
            reason: 'Prepared audio buffer ID is already occupied.',
        });
        await flushIndexedDbTasks();
        expect(audioBufferCache.get('ordinary-set-collision')).toBe(projectBuffer);
        expect(controls.committed.get('ordinary-set-collision')?.channelData[0]?.[0]).toBeCloseTo(0.15);
        expect(controls.committedMeta.get('ordinary-set-collision')?.preparedOwner).toBeUndefined();
    });

    it('does not publish prepared PCM over a newer ordinary runtime mutation when its durable write aborts', async () => {
        const controls = installFakeAudioIndexedDb();
        controls.pauseWriteSettlements();
        const prepared = createAudioBuffer({ length: 1, sampleRate: 48_000 });
        prepared.getChannelData(0)[0] = 0.25;
        const persistence = audioBufferCache.persistPreparedBuffer({ id: 'ordinary-abort-race', buffer: prepared });
        while (controls.pendingWriteSettlementCount() === 0) {
            await flushIndexedDbTasks(1);
        }

        controls.abortNextWrite();
        const ordinary = createAudioBuffer({ length: 1, sampleRate: 48_000 });
        ordinary.getChannelData(0)[0] = 0.85;
        audioBufferCache.set('ordinary-abort-race', ordinary);
        controls.releaseNextWriteSettlement();
        while (controls.pendingWriteSettlementCount() === 0) {
            await flushIndexedDbTasks(1);
        }
        controls.releaseNextWriteSettlement();
        await flushIndexedDbTasks(2);
        const persisted = await persistence;
        expect(persisted).toMatchObject({ status: 'persisted', bufferId: 'ordinary-abort-race' });

        expect(audioBufferCache.get('ordinary-abort-race')).toBe(ordinary);
        expect(controls.committed.get('ordinary-abort-race')?.channelData[0]?.[0]).toBeCloseTo(0.25);
        expect(controls.committedMeta.get('ordinary-abort-race')?.preparedOwner?.status).toBe('temporary');
    });

    it('keeps temporary prepared PCM out of non-lease restore and export until project promotion', async () => {
        installFakeAudioIndexedDb();
        const temporary = createAudioBuffer({ length: 1, sampleRate: 48_000 });
        temporary.getChannelData(0)[0] = 0.45;
        const persisted = await audioBufferCache.persistPreparedBuffer({
            id: 'temporary-isolation',
            buffer: temporary,
        });
        if (persisted.status !== 'persisted') {
            throw new TypeError('Expected temporary isolation fixture to persist');
        }

        await expect(audioBufferCache.exportBuffers(['temporary-isolation'])).resolves.toEqual({});
        clearRuntimeAudioBufferCache();
        const context = createTestContext(
            vi.fn((_numberOfChannels: number, length: number, sampleRate: number) =>
                createAudioBuffer({ length, sampleRate })
            )
        );
        const prepared = await audioBufferCache.prepareFromIdb({ context, ids: ['temporary-isolation'] });
        expect(prepared?.publish()).toBe(0);
        expect(audioBufferCache.has('temporary-isolation')).toBe(false);
        await expect(audioBufferCache.restoreFromIdb({ context, ids: ['temporary-isolation'] })).resolves.toBe(0);
        await expect(
            audioBufferCache.reopenPreparedBuffer({
                id: 'temporary-isolation',
                leaseId: persisted.leaseId,
                context,
            })
        ).resolves.toEqual({ status: 'reopened', bufferId: 'temporary-isolation', ownership: 'temporary' });

        await expect(
            audioBufferCache.releasePreparedBuffer({
                id: 'temporary-isolation',
                leaseId: persisted.leaseId,
                disposition: 'project-owned',
            })
        ).resolves.toEqual({ status: 'released', disposition: 'project-owned' });
        await expect(audioBufferCache.exportBuffers(['temporary-isolation'])).resolves.toHaveProperty(
            'temporary-isolation'
        );
        clearRuntimeAudioBufferCache();
        await expect(audioBufferCache.restoreFromIdb({ context, ids: ['temporary-isolation'] })).resolves.toBe(1);
    });

    it('does not publish prepared runtime PCM after a project-transition clear', async () => {
        const controls = installFakeAudioIndexedDb();
        controls.pauseWriteSettlements();
        const temporary = createAudioBuffer({ length: 1, sampleRate: 48_000 });
        temporary.getChannelData(0)[0] = 0.55;
        const persistence = audioBufferCache.persistPreparedBuffer({ id: 'clear-race', buffer: temporary });
        while (controls.pendingWriteSettlementCount() === 0) {
            await flushIndexedDbTasks(1);
        }

        clearRuntimeAudioBufferCache();
        controls.releaseNextWriteSettlement();
        const persisted = await persistence;
        expect(persisted).toMatchObject({ status: 'persisted', bufferId: 'clear-race' });
        if (persisted.status !== 'persisted') {
            throw new TypeError('Expected clear-race prepared PCM to remain durable');
        }
        expect(audioBufferCache.has('clear-race')).toBe(false);
        expect(controls.committed.get('clear-race')?.channelData[0]?.[0]).toBeCloseTo(0.55);
        await expect(
            audioBufferCache.reopenPreparedBuffer({
                id: 'clear-race',
                leaseId: persisted.leaseId,
                context: createTestContext(
                    vi.fn((_numberOfChannels: number, length: number, sampleRate: number) =>
                        createAudioBuffer({ length, sampleRate })
                    )
                ),
            })
        ).resolves.toEqual({ status: 'reopened', bufferId: 'clear-race', ownership: 'temporary' });
    });

    it('does not let prepared discard evict a newer ordinary runtime buffer', async () => {
        const controls = installFakeAudioIndexedDb();
        const temporary = createAudioBuffer({ length: 1, sampleRate: 48_000 });
        temporary.getChannelData(0)[0] = 0.25;
        const persisted = await audioBufferCache.persistPreparedBuffer({ id: 'discard-race', buffer: temporary });
        if (persisted.status !== 'persisted') {
            throw new TypeError('Expected discard-race prepared PCM to persist');
        }

        controls.pauseWriteSettlements();
        const discard = audioBufferCache.releasePreparedBuffer({
            id: 'discard-race',
            leaseId: persisted.leaseId,
            disposition: 'discard',
        });
        while (controls.pendingWriteSettlementCount() === 0) {
            await flushIndexedDbTasks(1);
        }
        const ordinary = createAudioBuffer({ length: 1, sampleRate: 48_000 });
        ordinary.getChannelData(0)[0] = 0.85;
        audioBufferCache.set('discard-race', ordinary);

        controls.releaseNextWriteSettlement();
        await expect(discard).resolves.toEqual({ status: 'released', disposition: 'discarded' });
        while (controls.pendingWriteSettlementCount() === 0) {
            await flushIndexedDbTasks(1);
        }
        controls.releaseNextWriteSettlement();
        await flushIndexedDbTasks(2);
        expect(audioBufferCache.get('discard-race')).toBe(ordinary);
        expect(controls.committed.get('discard-race')?.channelData[0]?.[0]).toBeCloseTo(0.85);
        expect(controls.committedMeta.get('discard-race')?.preparedOwner).toBeUndefined();
    });

    it('evicts matching prepared PCM after overlapping discard retries commit deletion', async () => {
        const controls = installFakeAudioIndexedDb();
        const temporary = createAudioBuffer({ length: 1, sampleRate: 48_000 });
        const persisted = await audioBufferCache.persistPreparedBuffer({ id: 'discard-retry', buffer: temporary });
        if (persisted.status !== 'persisted') {
            throw new TypeError('Expected discard-retry prepared PCM to persist');
        }

        controls.pauseWriteSettlements();
        const firstDiscard = audioBufferCache.releasePreparedBuffer({
            id: 'discard-retry',
            leaseId: persisted.leaseId,
            disposition: 'discard',
        });
        while (controls.pendingWriteSettlementCount() === 0) {
            await flushIndexedDbTasks(1);
        }
        const retryDiscard = audioBufferCache.releasePreparedBuffer({
            id: 'discard-retry',
            leaseId: persisted.leaseId,
            disposition: 'discard',
        });

        controls.releaseNextWriteSettlement();
        while (controls.pendingWriteSettlementCount() === 0) {
            await flushIndexedDbTasks(1);
        }
        controls.releaseNextWriteSettlement();
        await expect(firstDiscard).resolves.toEqual({ status: 'released', disposition: 'discarded' });
        await expect(retryDiscard).resolves.toEqual({ status: 'missing' });
        expect(audioBufferCache.has('discard-retry')).toBe(false);
        expect(controls.committed.has('discard-retry')).toBe(false);
        expect(controls.committedMeta.has('discard-retry')).toBe(false);
    });

    it('exports newer ordinary runtime PCM when its aborted write leaves temporary metadata durable', async () => {
        const controls = installFakeAudioIndexedDb();
        const temporary = createAudioBuffer({ length: 1, sampleRate: 48_000 });
        temporary.getChannelData(0)[0] = 0.25;
        const persisted = await audioBufferCache.persistPreparedBuffer({
            id: 'ordinary-export-abort',
            buffer: temporary,
        });
        if (persisted.status !== 'persisted') {
            throw new TypeError('Expected ordinary-export-abort prepared PCM to persist');
        }

        controls.pauseWriteSettlements();
        controls.abortNextWrite();
        const ordinary = createAudioBuffer({ length: 1, sampleRate: 48_000 });
        ordinary.getChannelData(0)[0] = 0.85;
        audioBufferCache.set('ordinary-export-abort', ordinary);
        while (controls.pendingWriteSettlementCount() === 0) {
            await flushIndexedDbTasks(1);
        }
        controls.releaseNextWriteSettlement();
        await flushIndexedDbTasks(2);

        await expect(audioBufferCache.exportBuffers(['ordinary-export-abort'])).resolves.toEqual({
            'ordinary-export-abort': {
                sampleRate: 48_000,
                numberOfChannels: 1,
                channelData: [encodeFloat32([0.85])],
            },
        });
        expect(controls.committedMeta.get('ordinary-export-abort')?.preparedOwner?.status).toBe('temporary');
    });

    it('rejects a settled temporary owner after reload while preserving its lease and exact PCM', async () => {
        const controls = installFakeAudioIndexedDb();
        const original = createAudioBuffer({ length: 1, sampleRate: 48_000 });
        original.getChannelData(0)[0] = 0.35;
        const first = await audioBufferCache.persistPreparedBuffer({ id: 'settled-reload', buffer: original });
        if (first.status !== 'persisted') {
            throw new TypeError('Expected settled prepared PCM fixture to persist');
        }

        vi.resetModules();
        ({ audioBufferCache } = await import('../audioBufferCache'));
        const context = createTestContext(
            vi.fn((_numberOfChannels: number, length: number, sampleRate: number) =>
                createAudioBuffer({ length, sampleRate })
            )
        );
        await expect(
            audioBufferCache.reopenPreparedBuffer({ id: 'settled-reload', leaseId: first.leaseId, context })
        ).resolves.toEqual({ status: 'reopened', bufferId: 'settled-reload', ownership: 'temporary' });
        const reopenedRuntime = audioBufferCache.get('settled-reload');
        const durablePcm = structuredClone(controls.committed.get('settled-reload'));
        const durableMeta = structuredClone(controls.committedMeta.get('settled-reload'));
        const unrelated = createAudioBuffer({ length: 1, sampleRate: 48_000 });
        unrelated.getChannelData(0)[0] = 0.85;

        await expect(
            audioBufferCache.persistPreparedBuffer({ id: 'settled-reload', buffer: unrelated })
        ).resolves.toEqual({
            status: 'failed',
            reason: 'Prepared audio buffer ID is already occupied.',
        });
        expect(audioBufferCache.get('settled-reload')).toBe(reopenedRuntime);
        expect(controls.committed.get('settled-reload')).toEqual(durablePcm);
        expect(controls.committedMeta.get('settled-reload')).toEqual(durableMeta);
        await expect(
            audioBufferCache.reopenPreparedBuffer({ id: 'settled-reload', leaseId: first.leaseId, context })
        ).resolves.toEqual({ status: 'reopened', bufferId: 'settled-reload', ownership: 'temporary' });
        await expect(
            audioBufferCache.releasePreparedBuffer({
                id: 'settled-reload',
                leaseId: first.leaseId,
                disposition: 'project-owned',
            })
        ).resolves.toEqual({ status: 'released', disposition: 'project-owned' });
    });

    it('does not let a stale reopen overwrite a newer prepared buffer in memory after it commits', async () => {
        const controls = installFakeAudioIndexedDb();
        controls.pauseWriteSettlements();
        const original = createAudioBuffer({ length: 1, sampleRate: 48_000 });
        original.getChannelData(0)[0] = 0.25;
        const first = audioBufferCache.persistPreparedBuffer({ id: 'reopen-race', buffer: original });
        while (controls.pendingWriteSettlementCount() === 0) {
            await flushIndexedDbTasks(1);
        }

        controls.pauseReadonlySettlements();
        controls.releaseNextWriteSettlement();
        const firstLeaseId = controls.committedMeta.get('reopen-race')?.preparedOwner?.leaseId;
        if (!firstLeaseId) {
            throw new TypeError('Expected the first in-flight owner to commit before its superseding write');
        }
        const staleReopen = audioBufferCache.reopenPreparedBuffer({
            id: 'reopen-race',
            leaseId: firstLeaseId,
            context: createTestContext(
                vi.fn((_numberOfChannels: number, length: number, sampleRate: number) =>
                    createAudioBuffer({ length, sampleRate })
                )
            ),
        });
        const replacement = createAudioBuffer({ length: 1, sampleRate: 48_000 });
        replacement.getChannelData(0)[0] = 0.75;
        const second = audioBufferCache.persistPreparedBuffer({ id: 'reopen-race', buffer: replacement });
        while (controls.pendingReadonlySettlementCount() === 0) {
            await flushIndexedDbTasks(1);
        }
        controls.releaseNextReadonlySettlement();
        await expect(staleReopen).resolves.toEqual({
            status: 'failed',
            reason: 'Prepared audio reopen was superseded.',
        });
        while (controls.pendingWriteSettlementCount() === 0) {
            await flushIndexedDbTasks(1);
        }

        controls.releaseNextWriteSettlement();
        const persisted = await second;
        expect(persisted).toMatchObject({ status: 'persisted', bufferId: 'reopen-race' });
        if (persisted.status !== 'persisted') {
            throw new TypeError('Expected replacement prepared PCM to persist');
        }
        while (controls.pendingReadonlySettlementCount() === 0) {
            await flushIndexedDbTasks(1);
        }
        controls.releaseNextReadonlySettlement();
        await expect(first).resolves.toEqual({
            status: 'failed',
            reason: 'Prepared audio persistence was superseded.',
        });
        const projectRelease = audioBufferCache.releasePreparedBuffer({
            id: 'reopen-race',
            leaseId: persisted.leaseId,
            disposition: 'project-owned',
        });
        while (controls.pendingWriteSettlementCount() === 0) {
            await flushIndexedDbTasks(1);
        }
        controls.releaseNextWriteSettlement();
        await expect(projectRelease).resolves.toEqual({ status: 'released', disposition: 'project-owned' });

        expect(audioBufferCache.get('reopen-race')).toBe(replacement);
        expect(controls.committed.get('reopen-race')?.channelData[0]?.[0]).toBeCloseTo(0.75);
        expect(controls.committedMeta.get('reopen-race')?.preparedOwner?.leaseId).toBe(persisted.leaseId);
        expect(controls.committedMeta.get('reopen-race')?.preparedOwner?.status).toBe('project-owned');
    });

    it('reports a committed owner as persisted when a superseding prepared write later aborts', async () => {
        const controls = installFakeAudioIndexedDb();
        controls.pauseWriteSettlements();
        const firstBuffer = createAudioBuffer({ length: 1, sampleRate: 48_000 });
        firstBuffer.getChannelData(0)[0] = 0.25;
        const first = audioBufferCache.persistPreparedBuffer({ id: 'commit-truth', buffer: firstBuffer });
        while (controls.pendingWriteSettlementCount() === 0) {
            await flushIndexedDbTasks(1);
        }

        controls.abortNextWrite();
        const secondBuffer = createAudioBuffer({ length: 1, sampleRate: 48_000 });
        secondBuffer.getChannelData(0)[0] = 0.75;
        const second = audioBufferCache.persistPreparedBuffer({ id: 'commit-truth', buffer: secondBuffer });
        controls.releaseNextWriteSettlement();
        while (controls.pendingWriteSettlementCount() === 0) {
            await flushIndexedDbTasks(1);
        }
        controls.releaseNextWriteSettlement();
        const [firstResult, secondResult] = await Promise.all([first, second]);

        expect(firstResult).toMatchObject({ status: 'persisted', bufferId: 'commit-truth' });
        expect(secondResult).toMatchObject({ status: 'failed', reason: 'IDB transaction aborted' });
        expect(controls.committed.get('commit-truth')?.channelData[0]?.[0]).toBeCloseTo(0.25);
        expect(controls.committedMeta.get('commit-truth')?.preparedOwner?.leaseId).toBe(
            firstResult.status === 'persisted' ? firstResult.leaseId : undefined
        );
        expect(audioBufferCache.get('commit-truth')).toBe(firstBuffer);
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
