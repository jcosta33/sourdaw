import { IDBFactory, IDBKeyRange, IDBObjectStore } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    ASSET_RESUME_CHUNKS,
    ASSET_RESUME_METADATA,
    type ResumeChunk,
    type ResumeMetadata,
} from '../../models/AssetTransferResume';
import {
    ASSET_CHUNK_SIZE,
    ASSET_REQUEST_MAX_ATTEMPTS,
    ASSET_REQUEST_RETRY_COOLDOWN_MS,
    type PeerMessage,
} from '../../models/CollaborationTypes';
import { DOC_ID_ASSET } from '../../models/SyncChannelConstants';
import * as resumeIndexedDb from '../../repositories/assetTransferResumeIndexedDb';
import { PeerConnectionManager } from '../../repositories/peerConnection';
import { AssetTransfer, ASSET_TRANSFER_STALL_TIMEOUT_MS } from '../assetTransfer';

const OWNER = 'aaaaaaaa-aaaa-8aaa-8aaa-aaaaaaaaaaaa';
const instances: AssetTransfer[] = [];

beforeEach(() => {
    vi.stubGlobal('indexedDB', new IDBFactory());
    vi.stubGlobal('IDBKeyRange', IDBKeyRange);
});
afterEach(() => {
    for (const transfer of instances.splice(0)) {
        transfer.dispose();
    }
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

function endpoint(owner = OWNER) {
    const sent: PeerMessage[] = [];
    const requests: Array<(message: PeerMessage) => void> = [];
    const peer = new PeerConnectionManager({
        onMessage: () => undefined,
        onConnected: () => undefined,
        onDisconnected: () => undefined,
    });
    vi.spyOn(peer, 'broadcastCrdtSync').mockImplementation((message) => {
        sent.push(message);
        requests.shift()?.(message);
    });
    const record = async ({ message }: { message: PeerMessage }) => {
        sent.push(message);
    };
    vi.spyOn(peer, 'sendCrdtSync').mockImplementation(record);
    vi.spyOn(peer, 'sendCrdtSyncBuffered').mockImplementation(record);
    const available = Promise.withResolvers<void>();
    const failed = Promise.withResolvers<void>();
    const callbacks = {
        onAssetAvailable: vi.fn(() => available.resolve()),
        onProgress: vi.fn(),
        onTransferFailed: vi.fn<(hash: string, reason: string, state: 'cooldown' | 'abandoned') => void>(() =>
            failed.resolve()
        ),
    };
    const transfer = new AssetTransfer(peer, callbacks, owner);
    instances.push(transfer);
    return {
        transfer,
        peer,
        sent,
        callbacks,
        completion: available.promise,
        failure: failed.promise,
        request: (hash: string) => {
            const pending = new Promise<PeerMessage>((resolve) => requests.push(resolve));
            transfer.requestAsset(hash);
            return pending;
        },
    };
}

function control(message: PeerMessage): Record<string, unknown> {
    if (message.type !== 'crdt-sync') {
        throw new TypeError('Expected serialized asset frame');
    }
    const value: unknown = JSON.parse(message.data);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError('Expected asset control object');
    }
    return value as Record<string, unknown>;
}

function withToken(message: PeerMessage, token: unknown): PeerMessage {
    if (message.type !== 'crdt-sync') {
        throw new TypeError('Expected serialized asset frame');
    }
    return { ...message, data: JSON.stringify({ ...control(message), attemptToken: token }) };
}

async function journalRows(): Promise<{ metadata: ResumeMetadata[]; chunks: ResumeChunk[] }> {
    const database = await resumeIndexedDb.openAssetTransferResumeDatabase();
    return new Promise((resolve, reject) => {
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

function receivedIndices(rows: Awaited<ReturnType<typeof journalRows>>): number[][] {
    return rows.metadata.map((row) =>
        rows.chunks
            .filter(
                (chunk) =>
                    chunk.ownerId === row.ownerId && chunk.hash === row.hash && chunk.generation === row.generation
            )
            .map((chunk) => chunk.index)
    );
}

async function partialFixture() {
    const sender = endpoint();
    const receiver = endpoint();
    const bytes = new Uint8Array(ASSET_CHUNK_SIZE * 2 + 17);
    for (let index = 0; index < bytes.length; index++) {
        bytes[index] = index % 251;
    }
    const hash = await sender.transfer.addLocalAsset(new Blob([bytes]), 'restart.wav');
    await sender.transfer.handleMessage('receiver-before-reload', await receiver.request(hash));
    await receiver.transfer.handleMessage('sender-before-reload', sender.sent[0]!);
    await receiver.transfer.handleMessage('sender-before-reload', sender.sent[1]!);
    expect(receiver.callbacks.onProgress).toHaveBeenLastCalledWith(hash, 1, 3);
    return { sender, receiver, bytes, hash };
}

async function finish(
    sender: ReturnType<typeof endpoint>,
    receiver: ReturnType<typeof endpoint>,
    request: PeerMessage
) {
    sender.sent.length = 0;
    await sender.transfer.handleMessage('receiver-after-reload', request);
    for (const message of sender.sent) {
        await receiver.transfer.handleMessage('sender-after-reload', message);
    }
    await receiver.completion;
}

describe('persisted asset restart over production serialized frames', () => {
    it('recovers valid progress without materializing thirty-two out-of-geometry rows', async () => {
        const { sender, receiver, hash, bytes } = await partialFixture();
        receiver.transfer.dispose();
        const stored = (await journalRows()).chunks[0]!;
        const database = await resumeIndexedDb.openAssetTransferResumeDatabase();
        await new Promise<void>((resolve, reject) => {
            const transaction = database.transaction(ASSET_RESUME_CHUNKS, 'readwrite');
            for (let index = 3; index < 35; index++) {
                transaction.objectStore(ASSET_RESUME_CHUNKS).put({
                    ...stored,
                    index,
                    data: new Uint8Array([index]),
                });
            }
            transaction.oncomplete = () => {
                database.close();
                resolve();
            };
            transaction.onabort = () => {
                database.close();
                reject(transaction.error);
            };
        });
        const cursor = vi.spyOn(IDBObjectStore.prototype, 'openCursor');
        const restarted = endpoint();
        const request = await restarted.request(hash);
        expect(control(request).missingChunks).toEqual([1, 2]);
        expect(cursor).toHaveBeenCalledTimes(2);
        expect(receivedIndices(await journalRows())).toEqual([[0]]);
        await finish(sender, restarted, request);
        expect(restarted.callbacks.onAssetAvailable).toHaveBeenCalledExactlyOnceWith(hash);
        expect(new Uint8Array(await restarted.transfer.getAsset(hash)!.arrayBuffer())).toEqual(bytes);
        expect(await journalRows()).toEqual({ metadata: [], chunks: [] });
    });

    it.each(['local claim', 'emitted request'] as const)(
        'allows five deliberate cancellations during %s followed by a real successful request',
        async (phase) => {
            const { sender, receiver, hash, bytes } = await partialFixture();
            receiver.transfer.dispose();
            const restarted = endpoint();
            vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
            for (let index = 0; index < 5; index++) {
                if (phase === 'local claim') {
                    const started = Promise.withResolvers<void>();
                    const release = Promise.withResolvers<void>();
                    const open = resumeIndexedDb.openAssetTransferResumeDatabase;
                    const held = vi
                        .spyOn(resumeIndexedDb, 'openAssetTransferResumeDatabase')
                        .mockImplementationOnce(async () => {
                            started.resolve();
                            await release.promise;
                            return open();
                        });
                    restarted.transfer.requestAsset(hash);
                    await started.promise;
                    const cancelled = restarted.transfer.cancelAssetRequest(hash);
                    release.resolve();
                    await cancelled;
                    held.mockRestore();
                } else {
                    await restarted.request(hash);
                    await restarted.transfer.cancelAssetRequest(hash);
                    expect(await journalRows()).toEqual({ metadata: [], chunks: [] });
                }
                await vi.advanceTimersByTimeAsync(ASSET_REQUEST_RETRY_COOLDOWN_MS + 1);
            }
            expect(restarted.sent).toHaveLength(phase === 'local claim' ? 0 : 5);
            expect(restarted.callbacks.onTransferFailed).not.toHaveBeenCalled();
            const request = await restarted.request(hash);
            expect(control(request).missingChunks).toEqual(phase === 'local claim' ? [1, 2] : []);
            await finish(sender, restarted, request);
            expect(restarted.callbacks.onAssetAvailable).toHaveBeenCalledExactlyOnceWith(hash);
            expect(new Uint8Array(await restarted.transfer.getAsset(hash)!.arrayBuffer())).toEqual(bytes);
            expect(restarted.callbacks.onTransferFailed).not.toHaveBeenCalled();
        }
    );

    it('keeps real peer failures and their cooldown across deliberate cancellation and abandons at five', async () => {
        const { receiver, hash } = await partialFixture();
        receiver.transfer.dispose();
        const restarted = endpoint();
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
        for (let index = 0; index < ASSET_REQUEST_MAX_ATTEMPTS; index++) {
            await restarted.request(hash);
            await vi.advanceTimersByTimeAsync(ASSET_TRANSFER_STALL_TIMEOUT_MS);
            expect(restarted.callbacks.onTransferFailed).toHaveBeenCalledTimes(index + 1);
            expect(restarted.callbacks.onTransferFailed).toHaveBeenLastCalledWith(
                hash,
                'the sending peer stopped responding',
                index === ASSET_REQUEST_MAX_ATTEMPTS - 1 ? 'abandoned' : 'cooldown'
            );
            const sentBeforeCancel = restarted.sent.length;
            await restarted.transfer.cancelAssetRequest(hash);
            restarted.transfer.requestAsset(hash);
            expect(restarted.sent).toHaveLength(sentBeforeCancel);
            if (index === 0) {
                await vi.advanceTimersByTimeAsync(ASSET_REQUEST_RETRY_COOLDOWN_MS);
                await restarted.request(hash);
                await restarted.transfer.cancelAssetRequest(hash);
                expect(restarted.callbacks.onTransferFailed).toHaveBeenCalledTimes(1);
            }
            await vi.advanceTimersByTimeAsync(ASSET_REQUEST_RETRY_COOLDOWN_MS);
        }
        const sentBeforeRetry = restarted.sent.length;
        await restarted.transfer.cancelAssetRequest(hash);
        restarted.transfer.requestAsset(hash);
        expect(restarted.sent).toHaveLength(sentBeforeRetry);
        expect(restarted.callbacks.onAssetAvailable).not.toHaveBeenCalled();
    });

    it.each([
        { phase: 'claim', complete: false },
        { phase: 'stored digest', complete: false },
        { phase: 'claim', complete: true },
        { phase: 'stored digest', complete: true },
    ])('keeps a held local $phase outside the peer deadline (complete: $complete)', async ({ phase, complete }) => {
        const { sender, receiver, hash, bytes } = await partialFixture();
        const nativeDigest = crypto.subtle.digest.bind(crypto.subtle);
        if (complete) {
            const assembling = Promise.withResolvers<void>();
            const finishAssembly = Promise.withResolvers<void>();
            const digest = vi.spyOn(crypto.subtle, 'digest').mockImplementation(async (...args) => {
                if (args[1].byteLength === bytes.length) {
                    assembling.resolve();
                    await finishAssembly.promise;
                }
                return nativeDigest(...args);
            });
            await receiver.transfer.handleMessage('sender-before-reload', sender.sent[2]!);
            await receiver.transfer.handleMessage('sender-before-reload', sender.sent[3]!);
            await assembling.promise;
            receiver.transfer.dispose();
            finishAssembly.resolve();
            digest.mockRestore();
        } else {
            receiver.transfer.dispose();
        }
        const started = Promise.withResolvers<void>();
        const release = Promise.withResolvers<void>();
        if (phase === 'claim') {
            const open = resumeIndexedDb.openAssetTransferResumeDatabase;
            vi.spyOn(resumeIndexedDb, 'openAssetTransferResumeDatabase').mockImplementationOnce(async () => {
                started.resolve();
                await release.promise;
                return open();
            });
        } else {
            let held = false;
            vi.spyOn(crypto.subtle, 'digest').mockImplementation(async (...args) => {
                if (!held) {
                    held = true;
                    started.resolve();
                    await release.promise;
                }
                return nativeDigest(...args);
            });
        }
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
        const restarted = endpoint();
        const requested = restarted.request(hash);
        await started.promise;
        try {
            await vi.advanceTimersByTimeAsync(ASSET_TRANSFER_STALL_TIMEOUT_MS + 1);
            restarted.transfer.requestAsset(hash);
            expect(restarted.sent).toEqual([]);
            expect(restarted.callbacks.onTransferFailed).not.toHaveBeenCalled();
            expect(restarted.callbacks.onAssetAvailable).not.toHaveBeenCalled();
        } finally {
            release.resolve();
        }
        if (complete) {
            await restarted.completion;
            expect(restarted.sent).toEqual([]);
            expect(restarted.callbacks.onAssetAvailable).toHaveBeenCalledExactlyOnceWith(hash);
            expect(new Uint8Array(await restarted.transfer.getAsset(hash)!.arrayBuffer())).toEqual(bytes);
            expect(restarted.callbacks.onTransferFailed).not.toHaveBeenCalled();
            expect(await journalRows()).toEqual({ metadata: [], chunks: [] });
        } else {
            expect(control(await requested).missingChunks).toEqual([1, 2]);
            expect(restarted.sent).toHaveLength(1);
            await vi.advanceTimersByTimeAsync(ASSET_TRANSFER_STALL_TIMEOUT_MS - 1);
            expect(restarted.callbacks.onTransferFailed).not.toHaveBeenCalled();
            await vi.advanceTimersByTimeAsync(1);
            expect(restarted.callbacks.onTransferFailed).toHaveBeenCalledExactlyOnceWith(
                hash,
                'the sending peer stopped responding',
                'cooldown'
            );
            expect(restarted.callbacks.onAssetAvailable).not.toHaveBeenCalled();
            await restarted.transfer.cancelAssetRequest(hash);
        }
    });

    it('ignores premature untagged frames while restart verification precedes the actual request', async () => {
        const { sender, receiver, hash, bytes } = await partialFixture();
        receiver.transfer.dispose();
        const started = Promise.withResolvers<void>();
        const release = Promise.withResolvers<void>();
        const nativeDigest = crypto.subtle.digest.bind(crypto.subtle);
        let held = false;
        vi.spyOn(crypto.subtle, 'digest').mockImplementation(async (...args) => {
            if (!held) {
                held = true;
                started.resolve();
                await release.promise;
            }
            return nativeDigest(...args);
        });
        const restarted = endpoint();
        const requested = restarted.request(hash);
        await started.promise;
        expect(restarted.sent).toEqual([]);
        try {
            await restarted.transfer.handleMessage('premature-peer', withToken(sender.sent[0]!, undefined));
            await restarted.transfer.handleMessage('premature-peer', withToken(sender.sent[2]!, undefined));
            const rows = await journalRows();
            expect({
                progress: restarted.callbacks.onProgress.mock.calls,
                received: receivedIndices(rows),
                requests: restarted.sent,
            }).toEqual({ progress: [], received: [[0]], requests: [] });
        } finally {
            release.resolve();
        }
        const request = await requested;
        expect(control(request).missingChunks).toEqual([1, 2]);
        await finish(sender, restarted, request);
        expect(restarted.callbacks.onAssetAvailable).toHaveBeenCalledExactlyOnceWith(hash);
        expect(new Uint8Array(await restarted.transfer.getAsset(hash)!.arrayBuffer())).toEqual(bytes);
    });

    it('admits a synchronous peer manifest at the actual request emission boundary', async () => {
        const { sender, receiver, hash, bytes } = await partialFixture();
        receiver.transfer.dispose();
        const restarted = endpoint();
        const delivered = Promise.withResolvers<void>();
        vi.mocked(restarted.peer.broadcastCrdtSync).mockImplementation((request) => {
            restarted.sent.push(request);
            const token = control(request).attemptToken;
            const manifest = restarted.transfer.handleMessage('synchronous-sender', withToken(sender.sent[0]!, token));
            void (async () => {
                await manifest;
                for (const message of sender.sent.slice(2)) {
                    await restarted.transfer.handleMessage('synchronous-sender', withToken(message, token));
                }
                await restarted.completion;
            })().then(delivered.resolve, delivered.reject);
        });
        restarted.transfer.requestAsset(hash);
        await delivered.promise;
        expect(restarted.callbacks.onAssetAvailable).toHaveBeenCalledExactlyOnceWith(hash);
        expect(new Uint8Array(await restarted.transfer.getAsset(hash)!.arrayBuffer())).toEqual(bytes);
    });

    it('reopens committed chunks with a new live peer and requests only missing indices', async () => {
        const { sender, receiver, bytes, hash } = await partialFixture();
        receiver.transfer.dispose();

        const restarted = endpoint();
        const request = await restarted.request(hash);
        expect(control(request).missingChunks).toEqual([1, 2]);
        expect(control(request).attemptToken).not.toBe(control(receiver.sent[0]!).attemptToken);
        sender.sent.length = 0;
        await sender.transfer.handleMessage('receiver-after-reload', request);
        const controls = sender.sent.map(control);
        const chunks = controls.filter((frame) => frame.type === 'asset.chunk');
        expect(chunks.map((frame) => frame.index)).toEqual([1, 2]);
        for (const message of sender.sent) {
            await restarted.transfer.handleMessage('sender-after-reload', message);
        }
        await restarted.completion;
        expect(restarted.callbacks.onAssetAvailable).toHaveBeenCalledExactlyOnceWith(hash);
        expect(new Uint8Array(await restarted.transfer.getAsset(hash)!.arrayBuffer())).toEqual(bytes);
        expect(await journalRows()).toEqual({ metadata: [], chunks: [] });
    });

    it('rehashes stored bytes and requests a corrupted committed index again after recreation', async () => {
        const { sender, receiver, bytes, hash } = await partialFixture();
        receiver.transfer.dispose();
        const stored = (await journalRows()).chunks[0]!;
        const database = await resumeIndexedDb.openAssetTransferResumeDatabase();
        await new Promise<void>((resolve, reject) => {
            const transaction = database.transaction(ASSET_RESUME_CHUNKS, 'readwrite');
            transaction
                .objectStore(ASSET_RESUME_CHUNKS)
                .put({ ...stored, data: new Uint8Array(stored.data.length).fill(255) });
            transaction.oncomplete = () => {
                database.close();
                resolve();
            };
            transaction.onabort = () => {
                database.close();
                reject(transaction.error);
            };
        });
        const restarted = endpoint();
        const request = await restarted.request(hash);
        expect(control(request).missingChunks).toEqual([0, 1, 2]);
        expect(receivedIndices(await journalRows())).toEqual([[]]);
        await finish(sender, restarted, request);
        expect(new Uint8Array(await restarted.transfer.getAsset(hash)!.arrayBuffer())).toEqual(bytes);
        expect(await journalRows()).toEqual({ metadata: [], chunks: [] });
    });

    it('keeps canonical project owners isolated and cancellation removes only its exact generation', async () => {
        const { sender, receiver, hash } = await partialFixture();
        receiver.transfer.dispose();
        const other = endpoint('bbbbbbbb-bbbb-8bbb-8bbb-bbbbbbbbbbbb');
        const otherRequest = await other.request(hash);
        expect(control(otherRequest).missingChunks).toEqual([]);
        sender.sent.length = 0;
        await sender.transfer.handleMessage('other-project', otherRequest);
        await other.transfer.handleMessage('other-sender', sender.sent[0]!);
        await other.transfer.handleMessage('other-sender', sender.sent[1]!);
        expect((await journalRows()).metadata.map((row) => row.ownerId).sort()).toEqual([
            OWNER,
            'bbbbbbbb-bbbb-8bbb-8bbb-bbbbbbbbbbbb',
        ]);
        await other.transfer.cancelAssetRequest(hash);
        expect((await journalRows()).metadata.map((row) => row.ownerId)).toEqual([OWNER]);
        const restarted = endpoint();
        expect(control(await restarted.request(hash)).missingChunks).toEqual([1, 2]);
    });

    it('retires incompatible persisted geometry before a fresh full request', async () => {
        const { sender, receiver, hash } = await partialFixture();
        receiver.transfer.dispose();
        const restarted = endpoint();
        const request = await restarted.request(hash);
        sender.sent.length = 0;
        await sender.transfer.handleMessage('new-receiver', request);
        const message = sender.sent[0]!;
        if (message.type !== 'crdt-sync') {
            throw new TypeError('Expected manifest frame');
        }
        const value = control(message);
        const manifest = value.manifest;
        if (!manifest || typeof manifest !== 'object' || !('chunkSize' in manifest)) {
            throw new TypeError('Expected manifest geometry');
        }
        await restarted.transfer.handleMessage('new-sender', {
            ...message,
            data: JSON.stringify({
                ...value,
                manifest: { ...manifest, chunkSize: ASSET_CHUNK_SIZE / 2, chunkCount: 5 },
            }),
        });
        expect(restarted.callbacks.onTransferFailed.mock.calls[0]?.[1]).toContain('fresh full request');
        await restarted.transfer.cancelAssetRequest(hash);
        expect(await journalRows()).toEqual({ metadata: [], chunks: [] });
        vi.spyOn(Date, 'now').mockReturnValue(Date.now() + ASSET_REQUEST_RETRY_COOLDOWN_MS + 1);
        expect(control(await restarted.request(hash)).missingChunks).toEqual([]);
    });

    it.each(['dispose', 'cancel'] as const)(
        'fences held verification after %s and preserves the declared restart outcome',
        async (mode) => {
            const { sender, receiver, hash } = await partialFixture();
            const started = Promise.withResolvers<void>();
            const release = Promise.withResolvers<void>();
            const nativeDigest = crypto.subtle.digest.bind(crypto.subtle);
            let held = false;
            vi.spyOn(crypto.subtle, 'digest').mockImplementation(async (...args) => {
                if (!held) {
                    held = true;
                    started.resolve();
                    await release.promise;
                }
                return nativeDigest(...args);
            });
            const pending = receiver.transfer.handleMessage('sender-before-reload', sender.sent[2]!);
            await started.promise;
            let cancellation: Promise<void> | undefined;
            if (mode === 'dispose') {
                receiver.transfer.dispose();
            } else {
                cancellation = receiver.transfer.cancelAssetRequest(hash);
            }
            release.resolve();
            await pending;
            await cancellation;
            expect(receiver.callbacks.onProgress).toHaveBeenCalledTimes(1);
            expect(receiver.callbacks.onAssetAvailable).not.toHaveBeenCalled();
            const rows = await journalRows();
            expect(receivedIndices(rows)).toEqual(mode === 'dispose' ? [[0]] : []);
            const restarted = endpoint();
            expect(control(await restarted.request(hash)).missingChunks).toEqual(mode === 'dispose' ? [1, 2] : []);
        }
    );

    it('awaits the committed revision when cancellation arrives before the append continuation', async () => {
        const { sender, receiver, hash } = await partialFixture();
        const nativePut = IDBObjectStore.prototype.put;
        const cancelled = Promise.withResolvers<Promise<void>>();
        let committed = false;
        const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
            this: IDBObjectStore,
            ...args
        ) {
            const request = nativePut.apply(this, args);
            if (this.name === ASSET_RESUME_CHUNKS) {
                this.transaction.addEventListener(
                    'complete',
                    () => {
                        committed = true;
                        cancelled.resolve(receiver.transfer.cancelAssetRequest(hash));
                    },
                    { once: true }
                );
            }
            return request;
        });
        await receiver.transfer.handleMessage('sender-before-reload', sender.sent[2]!);
        await cancelled.promise;
        put.mockRestore();
        expect(committed).toBe(true);
        expect(receiver.callbacks.onProgress).toHaveBeenCalledTimes(1);
        expect(receiver.callbacks.onAssetAvailable).not.toHaveBeenCalled();
        expect(await journalRows()).toEqual({ metadata: [], chunks: [] });
    });
    it.each(['success', 'mismatch', 'rejection', 'dispose', 'rebind'] as const)(
        'fully restored assembly survives the request stall deadline with %s',
        async (outcome) => {
            const { sender, receiver, bytes, hash } = await partialFixture();
            const nativeDigest = crypto.subtle.digest.bind(crypto.subtle);
            const verifiedDigest = await nativeDigest('SHA-256', bytes);
            const firstStarted = Promise.withResolvers<void>();
            const firstRelease = Promise.withResolvers<void>();
            const secondStarted = Promise.withResolvers<void>();
            const secondRelease = Promise.withResolvers<void>();
            let fullDigests = 0;
            vi.spyOn(crypto.subtle, 'digest').mockImplementation(async (...args) => {
                if (args[1].byteLength === bytes.length) {
                    fullDigests++;
                    if (fullDigests === 1) {
                        firstStarted.resolve();
                        await firstRelease.promise;
                        return verifiedDigest;
                    } else if (fullDigests === 2) {
                        secondStarted.resolve();
                        await secondRelease.promise;
                        if (outcome === 'rejection') {
                            throw new Error('Controlled final digest rejection');
                        }
                        if (outcome === 'mismatch') {
                            return new Uint8Array(32).buffer;
                        }
                        if (outcome === 'dispose' || outcome === 'rebind') {
                            return verifiedDigest;
                        }
                    }
                }
                return nativeDigest(...args);
            });
            await receiver.transfer.handleMessage('sender-before-reload', sender.sent[2]!);
            await receiver.transfer.handleMessage('sender-before-reload', sender.sent[3]!);
            await firstStarted.promise;
            receiver.transfer.dispose();
            firstRelease.resolve();
            vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
            const restarted = endpoint();
            restarted.transfer.requestAsset(hash);
            await secondStarted.promise;
            try {
                expect(restarted.sent).toEqual([]);
                expect(receiver.callbacks.onAssetAvailable).not.toHaveBeenCalled();
                await vi.advanceTimersByTimeAsync(ASSET_TRANSFER_STALL_TIMEOUT_MS);
                expect(restarted.callbacks.onTransferFailed).not.toHaveBeenCalled();
                if (outcome === 'dispose') {
                    restarted.transfer.dispose();
                } else if (outcome === 'rebind') {
                    const handoff = await restarted.transfer.prepareDurableOwnerRebind(
                        'bbbbbbbb-bbbb-8bbb-8bbb-bbbbbbbbbbbb'
                    );
                    if (handoff.status !== 'prepared') {
                        throw new Error('Expected prepared owner handoff');
                    }
                    expect(await handoff.commit()).toMatchObject({ status: 'committed' });
                }
            } finally {
                secondRelease.resolve();
            }
            if (outcome === 'success') {
                await restarted.completion;
                expect(restarted.callbacks.onAssetAvailable).toHaveBeenCalledExactlyOnceWith(hash);
                expect(new Uint8Array(await restarted.transfer.getAsset(hash)!.arrayBuffer())).toEqual(bytes);
                expect(restarted.callbacks.onTransferFailed).not.toHaveBeenCalled();
            } else if (outcome === 'dispose') {
                const replacement = endpoint();
                replacement.transfer.requestAsset(hash);
                await replacement.completion;
                expect(replacement.callbacks.onAssetAvailable).toHaveBeenCalledExactlyOnceWith(hash);
                expect(restarted.callbacks.onAssetAvailable).not.toHaveBeenCalled();
                expect(restarted.callbacks.onTransferFailed).not.toHaveBeenCalled();
            } else if (outcome === 'rebind') {
                expect(control(await restarted.request(hash)).missingChunks).toEqual([]);
                expect(restarted.callbacks.onAssetAvailable).not.toHaveBeenCalled();
                expect(restarted.callbacks.onTransferFailed).not.toHaveBeenCalled();
                expect((await journalRows()).metadata.map((row) => row.ownerId)).toEqual([OWNER]);
            } else {
                await restarted.failure;
                expect(restarted.callbacks.onAssetAvailable).not.toHaveBeenCalled();
                expect(restarted.callbacks.onTransferFailed).toHaveBeenCalledTimes(1);
                expect(restarted.callbacks.onTransferFailed.mock.calls[0]?.[1]).toContain(
                    outcome === 'mismatch' ? 'integrity check failed' : 'Controlled final digest rejection'
                );
                await restarted.transfer.cancelAssetRequest(hash);
            }
        }
    );

    it('streams sparse minimum-size chunks at maximum admitted geometry without reading ahead', async () => {
        const hash = `sha256:${'7'.repeat(64)}`;
        const bytes = new Uint8Array(4096).fill(17);
        const digest = `sha256:${Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (byte) =>
            byte.toString(16).padStart(2, '0')
        ).join('')}`;
        const wire = (value: unknown): PeerMessage => ({
            type: 'crdt-sync',
            docId: DOC_ID_ASSET,
            data: JSON.stringify(value),
        });
        const receiver = endpoint();
        const request = control(await receiver.request(hash));
        const manifest = {
            hash,
            size: 512 * 1024 * 1024,
            chunkSize: 4096,
            chunkCount: 131072,
            name: 'sparse.wav',
            mime: 'audio/wav',
            integrityVersion: 1,
        };
        await receiver.transfer.handleMessage(
            'minimum-chunk-peer',
            wire({ type: 'asset.manifest', manifest, attemptToken: request.attemptToken })
        );
        const retained = [0, 65536, 131071];
        for (const index of retained) {
            await receiver.transfer.handleMessage(
                'minimum-chunk-peer',
                wire({
                    type: 'asset.chunk',
                    hash,
                    index,
                    data: btoa(String.fromCharCode(...bytes)),
                    digest,
                    attemptToken: request.attemptToken,
                })
            );
        }
        expect(receiver.callbacks.onProgress).toHaveBeenLastCalledWith(hash, 3, 131072);
        receiver.transfer.dispose();
        const nativeGetAll = IDBObjectStore.prototype.getAll;
        const getAll = vi.spyOn(IDBObjectStore.prototype, 'getAll').mockImplementation(function (
            this: IDBObjectStore,
            ...args
        ) {
            if (this.name === ASSET_RESUME_CHUNKS) {
                throw new Error('Whole-range chunk materialization is forbidden');
            }
            return nativeGetAll.apply(this, args);
        });
        const cursor = vi.spyOn(IDBObjectStore.prototype, 'openCursor');
        const started = Promise.withResolvers<void>();
        const release = Promise.withResolvers<void>();
        const nativeDigest = crypto.subtle.digest.bind(crypto.subtle);
        let digests = 0;
        vi.spyOn(crypto.subtle, 'digest').mockImplementation(async (...args) => {
            digests++;
            if (digests === 1) {
                started.resolve();
                await release.promise;
            }
            return nativeDigest(...args);
        });
        const restarted = endpoint();
        const requested = restarted.request(hash);
        await started.promise;
        try {
            expect(cursor).toHaveBeenCalledTimes(1);
            expect(restarted.sent).toEqual([]);
        } finally {
            release.resolve();
        }
        const missing = control(await requested).missingChunks;
        if (!Array.isArray(missing)) {
            throw new TypeError('Expected missing indices');
        }
        expect(missing).toHaveLength(131069);
        expect(new Set(missing).size).toBe(131069);
        expect(
            missing.every(
                (index: unknown) =>
                    typeof index === 'number' &&
                    Number.isInteger(index) &&
                    index >= 0 &&
                    index < 131072 &&
                    !retained.includes(index)
            )
        ).toBe(true);
        expect(cursor).toHaveBeenCalledTimes(3);
        expect(digests).toBe(3);
        getAll.mockRestore();
        expect(receivedIndices(await journalRows())).toEqual([retained]);
    });

    it.each(['payload-index', 'typed-data', 'digest'] as const)(
        'discards the exact stored key of a malformed %s row before repair',
        async (kind) => {
            const { sender, receiver, hash } = await partialFixture();
            receiver.transfer.dispose();
            const nativeCursor = IDBObjectStore.prototype.openCursor;
            const value = vi.spyOn(IDBObjectStore.prototype, 'openCursor').mockImplementation(function (
                this: IDBObjectStore,
                ...args
            ) {
                const request = nativeCursor.apply(this, args);
                if (this.name === ASSET_RESUME_CHUNKS) {
                    request.addEventListener(
                        'success',
                        () => {
                            const cursor = request.result;
                            if (!cursor) {
                                return;
                            }
                            const stored: unknown = cursor.value;
                            if (!stored || typeof stored !== 'object') {
                                throw new Error('Expected stored row');
                            }
                            let malformed: Record<string, unknown>;
                            if (kind === 'payload-index') {
                                malformed = { ...stored, index: 1 };
                            } else if (kind === 'typed-data') {
                                malformed = { ...stored, data: new Uint16Array(4) };
                            } else {
                                malformed = { ...stored, digest: 'invalid-digest' };
                            }
                            Object.defineProperty(cursor, 'value', { value: malformed });
                        },
                        { once: true }
                    );
                }
                return request;
            });
            const restarted = endpoint();
            const request = await restarted.request(hash);
            value.mockRestore();
            expect(control(request).missingChunks).toEqual([0, 1, 2]);
            expect((await journalRows()).chunks).toEqual([]);
            await finish(sender, restarted, request);
            expect(restarted.callbacks.onAssetAvailable).toHaveBeenCalledExactlyOnceWith(hash);
        }
    );
});
