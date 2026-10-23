import { IDBFactory, IDBKeyRange, IDBObjectStore } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { testOverrides } from '#/infra/di/internal/containerState';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { hydrateTracksForProject } from '#/modules/Arrangement/useCases';
import { exportCachedAudioBuffers, getCachedAudioBuffer } from '#/modules/AudioEngine/useCases';
import {
    readNativeLibrarySampleFile,
    resolveDroppedSampleFile,
    resolveMappedLibraryAssetCandidate,
} from '#/modules/SampleLibrary/useCases';

import { ASSET_RESUME_CHUNKS, ASSET_RESUME_DATABASE, ASSET_RESUME_METADATA } from '../../models/AssetTransferResume';
import { ASSET_CHUNK_SIZE, MAX_ASSET_SIZE, type PeerMessage } from '../../models/CollaborationTypes';
import { DOC_ID_ASSET } from '../../models/SyncChannelConstants';
import { openAssetTransferResumeDatabase } from '../../repositories/assetTransferResumeIndexedDb';
import { PeerConnectionManager } from '../../repositories/peerConnection';
import { AssetTransfer } from '../assetTransfer';
import { AutomergeSync } from '../automergeSync';
import { sessionRuntimePrimitives as runtime } from '../collaboration/sessionManagement';

import type { Clip } from '#/modules/Arrangement/stores';

const installed = vi.hoisted(() => {
    const tracks: Array<{ id: string; clips: Array<{ id: string; assetHash: string; audioBufferId: string }> }> = [];
    return { tracks, decode: vi.fn<(data: ArrayBuffer) => Promise<AudioBuffer>>() };
});

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Arrangement/stores')>();
    return {
        ...actual,
        trackStore: {
            ...actual.trackStore,
            get value() {
                return { tracks: installed.tracks };
            },
        },
    };
});
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    getAudioContext: () => ({ decodeAudioData: installed.decode }),
}));
vi.mock('#/modules/CrdtDocument/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/CrdtDocument/useCases')>();
    const { init, getHeads } = await import('@automerge/automerge');
    const root = init();
    // This probe keeps the installed asset callback, PCM cache and export real;
    // CRDT projection/persistence are independent session setup/teardown seams.
    return {
        ...actual,
        setupProjectionBridge: () => () => undefined,
        getCrdtDoc: (id: string) => (id === actual.DOC_PREFIX_ROOT ? root : actual.getCrdtDoc(id)),
        runCrdtPersistenceBarrier: async () => ({
            status: 'persisted',
            mode: 'exact',
            expectedRootHeads: getHeads(root).map(String).toSorted(),
        }),
    };
});

const OWNER = 'aaaaaaaa-aaaa-8aaa-8aaa-aaaaaaaaaaaa';
const SETTINGS_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const DATABASE = 'sourdaw-library-asset-mappings';
const instances: AssetTransfer[] = [];

beforeEach(() => {
    vi.stubGlobal('indexedDB', new IDBFactory());
    vi.stubGlobal('IDBKeyRange', IDBKeyRange);
    installed.tracks.length = 0;
    installed.decode.mockReset();
});

afterEach(async () => {
    runtime.cleanup();
    await runtime.settleRetainedTeardown();
    for (const transfer of instances.splice(0)) {
        transfer.dispose();
    }
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

async function seedBinding(hash: string): Promise<void> {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(DATABASE, 1);
        request.onupgradeneeded = () => {
            request.result.createObjectStore('settings');
            request.result.createObjectStore('mappings');
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(['settings', 'mappings'], 'readwrite');
        transaction.objectStore('settings').put(SETTINGS_ID, 'localPeerSettingsId');
        transaction.objectStore('mappings').put(
            {
                schemaVersion: 1,
                localPeerSettingsId: SETTINGS_ID,
                hash,
                sampleId: 'sample-one',
                libraryRootId: 'root-one',
                relativePath: 'Drums/kick.wav',
            },
            [SETTINGS_ID, hash]
        );
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(transaction.error);
    }).finally(() => database.close());
}

function endpoint(owner = OWNER) {
    const peer = new PeerConnectionManager({
        onMessage: () => undefined,
        onConnected: () => undefined,
        onDisconnected: () => undefined,
    });
    const sent: PeerMessage[] = [];
    const responses: PeerMessage[] = [];
    const settled = Promise.withResolvers<'available' | 'requested' | 'failed'>();
    vi.spyOn(peer, 'broadcastCrdtSync').mockImplementation((message) => {
        sent.push(message);
        settled.resolve('requested');
    });
    const available = Promise.withResolvers<void>();
    const record = async ({ message }: { message: PeerMessage }) => {
        responses.push(message);
    };
    vi.spyOn(peer, 'sendCrdtSync').mockImplementation(record);
    vi.spyOn(peer, 'sendCrdtSyncBuffered').mockImplementation(record);
    const callbacks = {
        onAssetAvailable: vi.fn(() => {
            settled.resolve('available');
            available.resolve();
        }),
        onProgress: vi.fn(),
        onTransferFailed: vi.fn(() => settled.resolve('failed')),
    };
    const transfer = new AssetTransfer(peer, callbacks, owner);
    instances.push(transfer);
    return { transfer, peer, sent, responses, callbacks, settled: settled.promise, available: available.promise };
}

function knownLibrary() {
    return {
        value: {
            roots: [
                {
                    id: 'root-one',
                    provider: 'desktop',
                    rootRef: '/granted/Samples',
                    status: 'ready',
                },
            ],
            samples: [
                {
                    id: 'sample-one',
                    libraryRootId: 'root-one',
                    relativePath: 'Drums/kick.wav',
                    displayName: 'kick.wav',
                    sync: { exists: true, status: 'indexed' },
                },
            ],
        },
    };
}

function armNativeLibrary(bytes: Uint8Array) {
    const readNativeAudioFileBytes = vi.fn(async () => bytes);
    injectDependencies(resolveDroppedSampleFile, {
        libraryStore: knownLibrary(),
        isNativeSampleLibraryRuntimeAvailable: () => true,
        readNativeLibrarySampleFile,
        readBrowserLibrarySampleFile: vi.fn(),
    });
    testOverrides.set(readNativeLibrarySampleFile._deps.readNativeAudioFileBytes, readNativeAudioFileBytes);
    return readNativeAudioFileBytes;
}

function armKnownFile(file: File) {
    injectDependencies(resolveMappedLibraryAssetCandidate, {
        libraryStore: knownLibrary(),
        mappings: resolveMappedLibraryAssetCandidate._deps.mappings,
        resolveDroppedSampleFile: async () => ({ status: 'resolved', provider: 'desktop', file }),
    });
}

function admittedRecovery(transfer: AssetTransfer, hash: string): Promise<unknown> {
    const attempts: unknown = Reflect.get(transfer, 'receiveAttempts');
    if (!(attempts instanceof Map)) {
        throw new TypeError('Expected admitted receive attempts');
    }
    const attempt: unknown = attempts.get(hash);
    if (!attempt || typeof attempt !== 'object' || !('recovery' in attempt) || !(attempt.recovery instanceof Promise)) {
        throw new TypeError('Expected the actual admitted recovery task');
    }
    return attempt.recovery;
}

async function rows() {
    const database = await openAssetTransferResumeDatabase();
    return new Promise<{ metadata: unknown[]; chunks: unknown[] }>((resolve, reject) => {
        const transaction = database.transaction([ASSET_RESUME_METADATA, ASSET_RESUME_CHUNKS], 'readonly');
        const metadata = transaction.objectStore(ASSET_RESUME_METADATA).getAll();
        const chunks = transaction.objectStore(ASSET_RESUME_CHUNKS).getAll();
        transaction.oncomplete = () => {
            database.close();
            resolve({ metadata: metadata.result, chunks: chunks.result });
        };
        transaction.onabort = () => {
            database.close();
            reject(transaction.error);
        };
    });
}

function rowsForHash(records: unknown[], hash: string): unknown[] {
    return records.filter(
        (record) => typeof record === 'object' && record !== null && 'hash' in record && record.hash === hash
    );
}

async function finishNetwork(sender: ReturnType<typeof endpoint>, receiver: ReturnType<typeof endpoint>) {
    await sender.transfer.handleMessage('replacement-receiver', receiver.sent[0]!);
    for (const response of sender.responses) {
        await receiver.transfer.handleMessage('actual-sender', response);
    }
    await receiver.available;
}

async function partialFixture(fill = 42) {
    const bytes = new Uint8Array(ASSET_CHUNK_SIZE * 2 + 13).fill(fill);
    const sender = endpoint();
    const receiver = endpoint();
    const hash = await sender.transfer.addLocalAsset(new Blob([bytes]), 'kick.wav');
    receiver.transfer.requestAsset(hash);
    expect(await receiver.settled).toBe('requested');
    await sender.transfer.handleMessage('first-receiver', receiver.sent[0]!);
    await receiver.transfer.handleMessage('actual-sender', sender.responses[0]!);
    await receiver.transfer.handleMessage('actual-sender', sender.responses[1]!);
    expect(receiver.callbacks.onProgress).toHaveBeenCalledWith(hash, 1, 3);
    receiver.transfer.dispose();
    return { bytes, sender, hash };
}

function decodedBuffer(): AudioBuffer {
    const channel = new Float32Array([0.25, -0.5, 0.75, 0]);
    return {
        duration: channel.length / 48000,
        length: channel.length,
        sampleRate: 48000,
        numberOfChannels: 1,
        getChannelData: () => channel,
        copyFromChannel: (destination, _channel, start = 0) => {
            destination.set(channel.subarray(start, start + destination.length));
        },
        copyToChannel: (source, _channel, start = 0) => {
            channel.set(source, start);
        },
    };
}

describe('local library fulfillment through the real asset request boundary', () => {
    it('reopens a persisted raw binding in a new manager without emitting an asset request', async () => {
        const bytes = new Uint8Array([82, 73, 70, 70, 9, 3, 7, 1]);
        const original = endpoint();
        const hash = await original.transfer.addLocalAsset(new Blob([bytes]), 'kick.wav');
        await seedBinding(hash);
        original.transfer.dispose();
        const read = armNativeLibrary(bytes);

        const replacement = endpoint('cccccccc-cccc-8ccc-8ccc-cccccccccccc');
        replacement.transfer.requestAsset(hash);

        expect(await replacement.settled).toBe('available');
        expect(replacement.sent).toEqual([]);
        expect(read).toHaveBeenCalledExactlyOnceWith({ path: '/granted/Samples/Drums/kick.wav' });
        expect(replacement.callbacks.onAssetAvailable).toHaveBeenCalledExactlyOnceWith(hash);
        const blob = replacement.transfer.getAsset(hash);
        expect(blob).toBeInstanceOf(Blob);
        expect(new Uint8Array(await blob!.arrayBuffer())).toEqual(bytes);
    });

    it('coalesces repeated calls and rejects premature frames while a mapped file read is held', async () => {
        const bytes = new Uint8Array([1, 2, 3, 4]);
        const sender = endpoint();
        const hash = await sender.transfer.addLocalAsset(new Blob([bytes]), 'kick.wav');
        await seedBinding(hash);
        const read = armNativeLibrary(bytes);
        const entered = Promise.withResolvers<void>();
        const release = Promise.withResolvers<Uint8Array>();
        read.mockImplementation(() => {
            entered.resolve();
            return release.promise;
        });
        const receiver = endpoint();
        receiver.transfer.requestAsset(hash);
        await entered.promise;
        for (let index = 0; index < 200; index++) {
            receiver.transfer.requestAsset(hash);
        }
        await sender.transfer.handleMessage('early-requester', {
            type: 'crdt-sync',
            docId: DOC_ID_ASSET,
            data: JSON.stringify({ type: 'asset.request', hash, missingChunks: [] }),
        });
        for (const response of sender.responses) {
            await receiver.transfer.handleMessage('premature-peer', response);
        }
        expect(receiver.sent).toEqual([]);
        expect(receiver.callbacks.onProgress).not.toHaveBeenCalled();
        expect(await rows()).toEqual({ metadata: [], chunks: [] });
        release.resolve(bytes);
        await receiver.available;
        expect(read).toHaveBeenCalledTimes(1);
        expect(receiver.callbacks.onAssetAvailable).toHaveBeenCalledExactlyOnceWith(hash);
        expect(receiver.sent).toEqual([]);
    });

    it('keeps a verified copied blob independent from a mutable candidate buffer during hashing', async () => {
        const bytes = new Uint8Array([3, 5, 7, 11]);
        const expected = bytes.slice();
        const sender = endpoint();
        const hash = await sender.transfer.addLocalAsset(new Blob([expected]), 'kick.wav');
        await seedBinding(hash);
        const file = new File([expected], 'kick.wav', { type: 'audio/wav' });
        vi.spyOn(file, 'arrayBuffer').mockResolvedValue(bytes.buffer);
        armKnownFile(file);
        const entered = Promise.withResolvers<void>();
        const release = Promise.withResolvers<void>();
        const digest = crypto.subtle.digest.bind(crypto.subtle);
        vi.spyOn(crypto.subtle, 'digest').mockImplementation(async (...args) => {
            entered.resolve();
            await release.promise;
            return digest(...args);
        });
        const receiver = endpoint();
        receiver.transfer.requestAsset(hash);
        await entered.promise;
        bytes.fill(99);
        release.resolve();
        expect(await receiver.settled).toBe('available');
        expect(new Uint8Array(await receiver.transfer.getAsset(hash)!.arrayBuffer())).toEqual(expected);
        expect(receiver.sent).toEqual([]);
    });

    it('falls through a changed local file to a real chunked peer response and final whole SHA', async () => {
        const sender = endpoint();
        const bytes = new Uint8Array([2, 4, 6, 8]);
        const hash = await sender.transfer.addLocalAsset(new Blob([bytes]), 'kick.wav');
        await seedBinding(hash);
        armNativeLibrary(new Uint8Array([9, 9, 9, 9]));
        const receiver = endpoint();
        receiver.transfer.requestAsset(hash);
        expect(await receiver.settled).toBe('requested');
        expect(receiver.callbacks.onAssetAvailable).not.toHaveBeenCalled();
        await finishNetwork(sender, receiver);
        expect(new Uint8Array(await receiver.transfer.getAsset(hash)!.arrayBuffer())).toEqual(bytes);
        expect(receiver.callbacks.onAssetAvailable).toHaveBeenCalledExactlyOnceWith(hash);
    });

    it('rejects an oversized candidate before arrayBuffer and preserves the ordinary request route', async () => {
        const sender = endpoint();
        const hash = await sender.transfer.addLocalAsset(new Blob(['bounded original']), 'kick.wav');
        await seedBinding(hash);
        const file = new File(['tiny actual bytes'], 'kick.wav');
        vi.spyOn(file, 'size', 'get').mockReturnValue(MAX_ASSET_SIZE + 1);
        const read = vi.spyOn(file, 'arrayBuffer');
        armKnownFile(file);
        const receiver = endpoint();
        receiver.transfer.requestAsset(hash);
        expect(await receiver.settled).toBe('requested');
        expect(read).not.toHaveBeenCalled();
        await finishNetwork(sender, receiver);
        expect(receiver.callbacks.onAssetAvailable).toHaveBeenCalledExactlyOnceWith(hash);
    });

    it.each(['cancel', 'dispose', 'owner'])(
        'fences a held local file read after %s without a late availability or wire request',
        async (change) => {
            const bytes = new Uint8Array([13, 17, 19]);
            const original = endpoint();
            const hash = await original.transfer.addLocalAsset(new Blob([bytes]), 'kick.wav');
            await seedBinding(hash);
            const read = armNativeLibrary(bytes);
            const entered = Promise.withResolvers<void>();
            const release = Promise.withResolvers<Uint8Array>();
            read.mockImplementation(() => {
                entered.resolve();
                return release.promise;
            });
            const receiver = endpoint();
            receiver.transfer.requestAsset(hash);
            const recovery = admittedRecovery(receiver.transfer, hash);
            await entered.promise;
            if (change === 'cancel') {
                await receiver.transfer.cancelAssetRequest(hash);
            } else if (change === 'dispose') {
                receiver.transfer.dispose();
            } else {
                const handoff = await receiver.transfer.prepareDurableOwnerRebind(
                    'cccccccc-cccc-8ccc-8ccc-cccccccccccc'
                );
                if (handoff.status !== 'prepared') {
                    throw new TypeError('Expected prepared owner handoff');
                }
                await expect(handoff.commit()).resolves.toMatchObject({ status: 'committed' });
            }
            release.resolve(bytes);
            await recovery;
            expect(receiver.callbacks.onAssetAvailable).not.toHaveBeenCalled();
            expect(receiver.transfer.hasAsset(hash)).toBe(false);
            expect(receiver.sent).toEqual([]);
        }
    );

    it('removes the exact committed partial journal before making a full mapped copy available', async () => {
        const { bytes, hash } = await partialFixture();
        expect((await rows()).chunks).toHaveLength(1);
        await seedBinding(hash);
        armNativeLibrary(bytes);
        const receiver = endpoint();
        receiver.transfer.requestAsset(hash);
        expect(await receiver.settled).toBe('available');
        expect(await rows()).toEqual({ metadata: [], chunks: [] });
        expect(receiver.sent).toEqual([]);
        expect(new Uint8Array(await receiver.transfer.getAsset(hash)!.arrayBuffer())).toEqual(bytes);
    });

    it.each(['read', 'hash'])(
        'settles exact known journal cancellation while mapped %s is held without a late publication',
        async (phase) => {
            const { bytes, hash } = await partialFixture();
            const unrelated = await partialFixture(43);
            await seedBinding(hash);
            const read = armNativeLibrary(bytes);
            const entered = Promise.withResolvers<void>();
            const release = Promise.withResolvers<void>();
            if (phase === 'read') {
                read.mockImplementation(async () => {
                    entered.resolve();
                    await release.promise;
                    return bytes;
                });
            } else {
                const digest = crypto.subtle.digest.bind(crypto.subtle);
                vi.spyOn(crypto.subtle, 'digest').mockImplementation(async (...args) => {
                    if (args[1].byteLength === bytes.byteLength) {
                        entered.resolve();
                        await release.promise;
                    }
                    return digest(...args);
                });
            }
            const receiver = endpoint();
            receiver.transfer.requestAsset(hash);
            const recovery = admittedRecovery(receiver.transfer, hash);
            await entered.promise;
            const before = await rows();
            expect(rowsForHash(before.metadata, hash)).toMatchObject([{ received: [0] }]);
            expect(rowsForHash(before.chunks, hash)).toHaveLength(1);
            expect(rowsForHash(before.metadata, unrelated.hash)).toHaveLength(1);
            expect(rowsForHash(before.chunks, unrelated.hash)).toHaveLength(1);
            try {
                await receiver.transfer.cancelAssetRequest(hash);
                const cancelled = await rows();
                expect(rowsForHash(cancelled.metadata, hash)).toEqual([]);
                expect(rowsForHash(cancelled.chunks, hash)).toEqual([]);
                expect(rowsForHash(cancelled.metadata, unrelated.hash)).toEqual(
                    rowsForHash(before.metadata, unrelated.hash)
                );
                expect(rowsForHash(cancelled.chunks, unrelated.hash)).toEqual(
                    rowsForHash(before.chunks, unrelated.hash)
                );
                expect(receiver.callbacks.onAssetAvailable).not.toHaveBeenCalled();
                expect(receiver.transfer.hasAsset(hash)).toBe(false);
                expect(receiver.sent).toEqual([]);
            } finally {
                release.resolve();
            }
            await recovery;
            const settled = await rows();
            expect(rowsForHash(settled.metadata, hash)).toEqual([]);
            expect(rowsForHash(settled.chunks, hash)).toEqual([]);
            expect(rowsForHash(settled.metadata, unrelated.hash)).toEqual(rowsForHash(before.metadata, unrelated.hash));
            expect(rowsForHash(settled.chunks, unrelated.hash)).toEqual(rowsForHash(before.chunks, unrelated.hash));
            expect(receiver.callbacks.onAssetAvailable).not.toHaveBeenCalled();
            expect(receiver.transfer.hasAsset(hash)).toBe(false);
            expect(receiver.sent).toEqual([]);
        }
    );

    it('refuses availability when exact partial cleanup aborts and retains the committed progress', async () => {
        const { bytes, hash } = await partialFixture();
        await seedBinding(hash);
        armNativeLibrary(bytes);
        const remove = IDBObjectStore.prototype.delete;
        vi.spyOn(IDBObjectStore.prototype, 'delete').mockImplementation(function (this: IDBObjectStore, ...args) {
            const request = remove.apply(this, args);
            if (this.name === ASSET_RESUME_METADATA) {
                request.addEventListener('success', () => this.transaction.abort(), { once: true });
            }
            return request;
        });
        const receiver = endpoint();
        receiver.transfer.requestAsset(hash);
        expect(await receiver.settled).toBe('failed');
        expect(receiver.callbacks.onAssetAvailable).not.toHaveBeenCalled();
        expect(receiver.transfer.hasAsset(hash)).toBe(false);
        expect((await rows()).chunks).toHaveLength(1);
        expect(receiver.sent).toEqual([]);
    });

    it('does not publish a mapped hit when its existing partial journal cannot be read', async () => {
        const { bytes, hash } = await partialFixture();
        await seedBinding(hash);
        const read = armNativeLibrary(bytes);
        const open = indexedDB.open.bind(indexedDB);
        let refused = false;
        vi.spyOn(indexedDB, 'open').mockImplementation((name, version) => {
            if (name === ASSET_RESUME_DATABASE && !refused) {
                refused = true;
                throw new DOMException('controlled resume storage refusal', 'QuotaExceededError');
            }
            return open(name, version);
        });
        const receiver = endpoint();
        receiver.transfer.requestAsset(hash);
        expect(await receiver.settled).toBe('requested');
        expect(receiver.callbacks.onAssetAvailable).not.toHaveBeenCalled();
        expect(read).not.toHaveBeenCalled();
        expect((await rows()).chunks).toHaveLength(1);
    });

    it('does not publish an older lookup after a successor claims and completes its journal generation', async () => {
        const { bytes, hash } = await partialFixture();
        await seedBinding(hash);
        armNativeLibrary(bytes);
        const entered = Promise.withResolvers<void>();
        const release = Promise.withResolvers<void>();
        const digest = crypto.subtle.digest.bind(crypto.subtle);
        let held = false;
        vi.spyOn(crypto.subtle, 'digest').mockImplementation(async (...args) => {
            if (!held) {
                held = true;
                entered.resolve();
                await release.promise;
            }
            return digest(...args);
        });
        const older = endpoint();
        older.transfer.requestAsset(hash);
        const olderRecovery = admittedRecovery(older.transfer, hash);
        await entered.promise;
        const successor = endpoint();
        successor.transfer.requestAsset(hash);
        expect(await successor.settled).toBe('available');
        release.resolve();
        await olderRecovery;
        expect(older.callbacks.onAssetAvailable).not.toHaveBeenCalled();
        expect(older.transfer.hasAsset(hash)).toBe(false);
        expect(new Uint8Array(await successor.transfer.getAsset(hash)!.arrayBuffer())).toEqual(bytes);
        expect(await rows()).toEqual({ metadata: [], chunks: [] });
        expect(older.sent).toEqual([]);
        expect(successor.sent).toEqual([]);
    });

    it('preserves unknown journal metadata and keeps the request route when local completion cannot prove cleanup', async () => {
        const bytes = new Uint8Array([37, 41, 43]);
        const original = endpoint();
        const hash = await original.transfer.addLocalAsset(new Blob([bytes]), 'kick.wav');
        await seedBinding(hash);
        armNativeLibrary(bytes);
        const database = await openAssetTransferResumeDatabase();
        const unknown = { schemaVersion: 99, ownerId: OWNER, hash, unknownMarker: 'preserve future journal' };
        await new Promise<void>((resolve, reject) => {
            const transaction = database.transaction(ASSET_RESUME_METADATA, 'readwrite');
            transaction.objectStore(ASSET_RESUME_METADATA).put(unknown);
            transaction.oncomplete = () => resolve();
            transaction.onabort = () => reject(transaction.error);
        }).finally(() => database.close());
        const receiver = endpoint();
        receiver.transfer.requestAsset(hash);
        expect(await receiver.settled).toBe('requested');
        expect(await rows()).toEqual({ metadata: [unknown], chunks: [] });
        expect(receiver.callbacks.onAssetAvailable).not.toHaveBeenCalled();
        expect(receiver.sent).toHaveLength(1);
    });

    it('reports an integrity refusal when real incoming completion displaced a live stage membership', async () => {
        const blob = new Blob(['overlapping original']);
        const sender = endpoint();
        const receiver = endpoint();
        const hash = await sender.transfer.addLocalAsset(blob, 'kick.wav');
        receiver.transfer.requestAsset(hash);
        expect(await receiver.settled).toBe('requested');
        await sender.transfer.handleMessage('receiver', receiver.sent[0]!);
        await receiver.transfer.handleMessage('sender', sender.responses[0]!);
        const staged = await receiver.transfer.stageLocalAsset(blob, 'kick.wav');
        for (const response of sender.responses.slice(1)) {
            await receiver.transfer.handleMessage('sender', response);
        }
        await receiver.available;
        expect(() => receiver.transfer.promoteStagedAsset(staged.leaseId)).toThrow(
            `Cannot promote missing staged asset lease: ${staged.leaseId}`
        );
        expect(receiver.transfer.hasAsset(hash)).toBe(true);
    });

    it('runs the real installed session callback into normal active-clip PCM cache and export after disconnecting the library', async () => {
        const bytes = new Uint8Array([21, 23, 27, 31]);
        const original = endpoint();
        const hash = await original.transfer.addLocalAsset(new Blob([bytes]), 'kick.wav');
        await seedBinding(hash);
        const read = armNativeLibrary(bytes);
        original.transfer.dispose();
        vi.spyOn(AutomergeSync.prototype, 'start').mockImplementation(() => undefined);
        const peer = await runtime.initialize('cccccccc-cccc-8ccc-8ccc-cccccccccccc');
        const requests: PeerMessage[] = [];
        vi.spyOn(peer, 'broadcastCrdtSync').mockImplementation((message) => {
            requests.push(message);
        });
        const transfer = runtime.state.assetTransfer;
        if (!transfer) {
            throw new TypeError('Expected the real installed asset transfer');
        }
        const bufferId = `library-active-${crypto.randomUUID()}`;
        installed.tracks.push({
            id: 'active-track',
            clips: [{ id: 'active-clip', audioBufferId: bufferId, assetHash: hash }],
        });
        const pcm = decodedBuffer();
        installed.decode.mockResolvedValue(pcm);
        transfer.requestAsset(hash);
        await vi.waitFor(() => expect(getCachedAudioBuffer({ bufferId })).toBe(pcm));
        expect(installed.decode).toHaveBeenCalledTimes(1);
        expect(new Uint8Array(installed.decode.mock.calls[0]![0])).toEqual(bytes);
        read.mockRejectedValue(new Error('library disconnected after copied fulfillment'));
        const exported = await exportCachedAudioBuffers({ bufferIds: [bufferId] });
        expect(exported[bufferId]).toEqual({
            sampleRate: 48000,
            numberOfChannels: 1,
            channelData: [btoa(String.fromCharCode(...new Uint8Array(pcm.getChannelData(0).buffer)))],
        });
        expect(getCachedAudioBuffer({ bufferId })?.getChannelData(0)).toEqual(pcm.getChannelData(0));
        expect(requests).toEqual([]);
        expect(read).toHaveBeenCalledTimes(1);
        expect(new Uint8Array(await transfer.getAsset(hash)!.arrayBuffer())).toEqual(bytes);
    });

    it('decodes a later active clip from resident library bytes without another availability event', async () => {
        const bytes = new Uint8Array([41, 43, 47, 53]);
        const original = endpoint();
        const hash = await original.transfer.addLocalAsset(new Blob([bytes]), 'kick.wav');
        await seedBinding(hash);
        const read = armNativeLibrary(bytes);
        original.transfer.dispose();
        vi.spyOn(AutomergeSync.prototype, 'start').mockImplementation(() => undefined);
        const peer = await runtime.initialize('cccccccc-cccc-8ccc-8ccc-cccccccccccc');
        const requests: PeerMessage[] = [];
        vi.spyOn(peer, 'broadcastCrdtSync').mockImplementation((message) => {
            requests.push(message);
        });
        const transfer = runtime.state.assetTransfer;
        if (!transfer) {
            throw new TypeError('Expected the real installed asset transfer');
        }
        const pcm = decodedBuffer();
        installed.decode.mockResolvedValue(pcm);
        transfer.requestAsset(hash);
        await vi.waitFor(() => expect(transfer.getAsset(hash)).toBeDefined());
        expect(read).toHaveBeenCalledTimes(1);
        expect(installed.decode).not.toHaveBeenCalled();

        const bufferId = `library-later-${crypto.randomUUID()}`;
        const clip: Clip = {
            id: 'later-clip',
            trackId: 'later-track',
            name: 'Later clip',
            startBeat: 0,
            endBeat: 4,
            type: 'audio',
            audioBufferId: bufferId,
            assetHash: hash,
            fadeInBeats: 0,
            fadeOutBeats: 0,
            gain: 1,
            color: '#ff0000',
            locked: false,
            muted: false,
        };
        installed.tracks.push({ id: 'later-track', clips: [clip] });
        hydrateTracksForProject({ tracks: [{ id: 'later-track', name: 'Later track', kind: 'audio', clips: [clip] }] });

        await vi.waitFor(() => expect(getCachedAudioBuffer({ bufferId })).toBe(pcm));
        expect(installed.decode).toHaveBeenCalledTimes(1);
        expect(requests).toEqual([]);
        expect(read).toHaveBeenCalledTimes(1);
    });
});
