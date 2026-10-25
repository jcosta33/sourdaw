import { IDBFactory, IDBKeyRange, IDBObjectStore } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ASSET_RESUME_CHUNKS, ASSET_RESUME_METADATA, type ResumeMetadata } from '../../models/AssetTransferResume';
import { ASSET_CHUNK_SIZE, ASSET_REQUEST_MAX_ATTEMPTS, type PeerMessage } from '../../models/CollaborationTypes';
import { openAssetTransferResumeDatabase } from '../../repositories/assetTransferResumeIndexedDb';
import { PeerConnectionManager } from '../../repositories/peerConnection';
import { AssetTransfer } from '../assetTransfer';

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
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

function endpoint() {
    const sent: PeerMessage[] = [];
    const requests: Array<() => void> = [];
    const peer = new PeerConnectionManager({
        onMessage: () => undefined,
        onConnected: () => undefined,
        onDisconnected: () => undefined,
    });
    vi.spyOn(peer, 'broadcastCrdtSync').mockImplementation((message) => {
        sent.push(message);
        requests.shift()?.();
    });
    const record = async ({ message }: { message: PeerMessage }) => {
        sent.push(message);
    };
    vi.spyOn(peer, 'sendCrdtSync').mockImplementation(record);
    vi.spyOn(peer, 'sendCrdtSyncBuffered').mockImplementation(record);
    const completion = Promise.withResolvers<void>();
    const callbacks = {
        onAssetAvailable: vi.fn(() => completion.resolve()),
        onProgress: vi.fn(),
        onTransferFailed: vi.fn(),
    };
    const transfer = new AssetTransfer(peer, callbacks, OWNER);
    instances.push(transfer);
    return {
        transfer,
        peer,
        sent,
        callbacks,
        completion: completion.promise,
        request: (hash: string) => {
            const emitted = new Promise<void>((resolve) => requests.push(resolve));
            transfer.requestAsset(hash);
            return emitted;
        },
    };
}

function frame(message: PeerMessage): Record<string, unknown> {
    if (message.type !== 'crdt-sync') {
        throw new TypeError('Expected serialized asset message');
    }
    const value: unknown = JSON.parse(message.data);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError('Expected asset control object');
    }
    return value as Record<string, unknown>;
}

function rewrite(message: PeerMessage, change: (value: Record<string, unknown>) => void): PeerMessage {
    if (message.type !== 'crdt-sync') {
        throw new TypeError('Expected serialized asset message');
    }
    const value = frame(message);
    change(value);
    return { ...message, data: JSON.stringify(value) };
}

async function fixture() {
    const sender = endpoint();
    const receiver = endpoint();
    const bytes = new Uint8Array(ASSET_CHUNK_SIZE * 2 + 17).fill(37);
    const hash = await sender.transfer.addLocalAsset(new Blob([bytes]), 'integrity.wav');
    await receiver.request(hash);
    await sender.transfer.handleMessage('receiver', receiver.sent[0]!);
    await receiver.transfer.handleMessage('sender', sender.sent[0]!);
    return { sender, receiver, bytes, hash };
}

async function journalState(): Promise<{ received: number[][]; chunks: number }> {
    const database = await openAssetTransferResumeDatabase();
    return new Promise((resolve, reject) => {
        const transaction = database.transaction([ASSET_RESUME_METADATA, ASSET_RESUME_CHUNKS], 'readonly');
        const metadata = transaction.objectStore(ASSET_RESUME_METADATA).getAll();
        const chunks = transaction.objectStore(ASSET_RESUME_CHUNKS).getAllKeys();
        transaction.oncomplete = () => {
            database.close();
            resolve({
                received: metadata.result.map((row: ResumeMetadata) =>
                    chunks.result
                        .filter(
                            (key) =>
                                Array.isArray(key) &&
                                key[0] === row.ownerId &&
                                key[1] === row.hash &&
                                key[2] === row.generation
                        )
                        .map((key) => {
                            if (!Array.isArray(key) || typeof key[3] !== 'number') {
                                throw new TypeError('Expected a chunk key');
                            }
                            return key[3];
                        })
                ),
                chunks: chunks.result.length,
            });
        };
        transaction.onabort = () => {
            database.close();
            reject(transaction.error);
        };
    });
}

async function chunkDigest(bytes: Uint8Array): Promise<string> {
    const input = new Uint8Array(bytes.byteLength);
    input.set(bytes);
    const digest = await crypto.subtle.digest('SHA-256', input);
    return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

describe('negotiated chunk integrity over production serialized frames', () => {
    it('drops a duplicate and wrong-peer flood before queued digest work while required chunks still complete', async () => {
        const { sender, receiver, bytes, hash } = await fixture();
        const started = Promise.withResolvers<void>();
        const release = Promise.withResolvers<void>();
        const nativeDigest = crypto.subtle.digest.bind(crypto.subtle);
        let held = false;
        const digest = vi.spyOn(crypto.subtle, 'digest').mockImplementation(async (...args) => {
            if (!held) {
                held = true;
                started.resolve();
                await release.promise;
            }
            return nativeDigest(...args);
        });
        const first = receiver.transfer.handleMessage('sender', sender.sent[1]!);
        await started.promise;
        let floodSettled = false;
        const flood = Promise.all(
            Array.from({ length: 200 }, (_, index) => {
                if (index % 2 === 0) {
                    return receiver.transfer.handleMessage('sender', sender.sent[1]!);
                }
                return receiver.transfer.handleMessage(
                    'wrong-peer',
                    rewrite(sender.sent[2]!, (value) => {
                        value.index = -1;
                    })
                );
            })
        );
        void flood.then(() => {
            floodSettled = true;
        });
        try {
            await vi.waitFor(() => expect(floodSettled).toBe(true));
            expect(receiver.callbacks.onProgress).not.toHaveBeenCalled();
        } finally {
            release.resolve();
        }
        await first;
        await flood;
        for (const message of sender.sent.slice(2)) {
            await receiver.transfer.handleMessage('sender', message);
        }
        await receiver.completion;
        expect(receiver.callbacks.onAssetAvailable).toHaveBeenCalledExactlyOnceWith(hash);
        expect(new Uint8Array(await receiver.transfer.getAsset(hash)!.arrayBuffer())).toEqual(bytes);
        digest.mockRestore();
    });

    it('repairs only the corrupted middle index while retaining committed good chunks', async () => {
        const { sender, receiver, bytes, hash } = await fixture();
        await receiver.transfer.handleMessage('sender', sender.sent[1]!);
        const corrupt = rewrite(sender.sent[2]!, (value) => {
            if (typeof value.data !== 'string') {
                throw new TypeError('Expected encoded chunk');
            }
            const decoded = atob(value.data);
            value.data = btoa(String.fromCharCode(decoded.charCodeAt(0) ^ 1) + decoded.slice(1));
        });
        await receiver.transfer.handleMessage('sender', corrupt);
        expect(receiver.callbacks.onProgress).toHaveBeenCalledTimes(1);
        expect(frame(receiver.sent.at(-1)!).missingChunks).toEqual([1]);
        await receiver.transfer.handleMessage('sender', sender.sent[3]!);
        expect(receiver.callbacks.onProgress).toHaveBeenLastCalledWith(hash, 2, 3);
        const repair = receiver.sent.at(-1)!;
        sender.sent.length = 0;
        await sender.transfer.handleMessage('receiver', repair);
        const controls = sender.sent.map(frame);
        const chunks = controls.filter((value) => value.type === 'asset.chunk');
        expect(chunks.map((value) => value.index)).toEqual([1]);
        for (const message of sender.sent) {
            await receiver.transfer.handleMessage('sender', message);
        }
        await receiver.completion;
        expect(receiver.callbacks.onAssetAvailable).toHaveBeenCalledExactlyOnceWith(hash);
        expect(new Uint8Array(await receiver.transfer.getAsset(hash)!.arrayBuffer())).toEqual(bytes);
    });

    it.each(['missing', 'malformed'] as const)('never commits an index with a %s negotiated digest', async (kind) => {
        const { sender, receiver, hash } = await fixture();
        await receiver.transfer.handleMessage(
            'sender',
            rewrite(sender.sent[1]!, (value) => {
                if (kind === 'missing') {
                    delete value.digest;
                } else {
                    value.digest = 'not-a-sha256';
                }
            })
        );
        expect(receiver.callbacks.onProgress).not.toHaveBeenCalled();
        expect(receiver.transfer.hasAsset(hash)).toBe(false);
        expect(frame(receiver.sent.at(-1)!).missingChunks).toEqual([0]);
        expect(await journalState()).toEqual({ received: [[]], chunks: 0 });
        await receiver.transfer.cancelAssetRequest(hash);
    });

    it('admits an immediate same-index repair without the rejected frame clearing its reservation', async () => {
        const { sender, receiver, bytes, hash } = await fixture();
        const first = sender.sent[1]!;
        const middle = sender.sent[2]!;
        const last = sender.sent[3]!;
        vi.mocked(sender.peer.sendCrdtSync).mockImplementation(async ({ message }) => {
            sender.sent.push(message);
            await receiver.transfer.handleMessage('sender', message);
        });
        vi.mocked(sender.peer.sendCrdtSyncBuffered).mockImplementation(async ({ message }) => {
            sender.sent.push(message);
            await receiver.transfer.handleMessage('sender', message);
        });
        vi.mocked(receiver.peer.sendCrdtSync).mockImplementation(async ({ message }) => {
            receiver.sent.push(message);
            await sender.transfer.handleMessage('receiver', message);
        });
        await receiver.transfer.handleMessage('sender', first);
        await receiver.transfer.handleMessage(
            'sender',
            rewrite(middle, (value) => {
                delete value.digest;
            })
        );
        await receiver.transfer.handleMessage('sender', last);
        await receiver.completion;
        const controls = receiver.sent.map(frame);
        const repairs = controls.filter((value) => value.repairSequence !== undefined);
        expect(repairs.map((value) => value.missingChunks)).toEqual([[1]]);
        expect(receiver.callbacks.onAssetAvailable).toHaveBeenCalledExactlyOnceWith(hash);
        expect(new Uint8Array(await receiver.transfer.getAsset(hash)!.arrayBuffer())).toEqual(bytes);
    });

    it('still rejects the whole asset when tampered bytes carry matching per-chunk digests', async () => {
        const { sender, receiver, hash } = await fixture();
        for (const message of sender.sent.slice(1)) {
            const value = frame(message);
            let wire = message;
            if (value.index === 1) {
                const bytes = new Uint8Array(ASSET_CHUNK_SIZE).fill(91);
                const digest = await chunkDigest(bytes);
                wire = rewrite(message, (chunk) => {
                    chunk.data = btoa(String.fromCharCode(91).repeat(bytes.length));
                    chunk.digest = digest;
                });
            }
            await receiver.transfer.handleMessage('sender', wire);
        }
        await vi.waitFor(() => expect(receiver.callbacks.onTransferFailed).toHaveBeenCalledTimes(1));
        expect(receiver.callbacks.onTransferFailed.mock.calls[0]?.[1]).toContain('integrity check failed');
        expect(receiver.callbacks.onProgress).toHaveBeenLastCalledWith(hash, 3, 3);
        expect(receiver.callbacks.onAssetAvailable).not.toHaveBeenCalled();
        expect(receiver.transfer.hasAsset(hash)).toBe(false);
        await receiver.transfer.cancelAssetRequest(hash);
        expect(await journalState()).toEqual({ received: [], chunks: 0 });
    });

    it('repairs a short final chunk even when its supplied digest matches those short bytes', async () => {
        const { sender, receiver, bytes, hash } = await fixture();
        await receiver.transfer.handleMessage('sender', sender.sent[1]!);
        await receiver.transfer.handleMessage('sender', sender.sent[2]!);
        const short = new Uint8Array(16).fill(37);
        const digest = await chunkDigest(short);
        await receiver.transfer.handleMessage(
            'sender',
            rewrite(sender.sent[3]!, (value) => {
                value.data = btoa('%'.repeat(short.length));
                value.digest = digest;
            })
        );
        expect(receiver.callbacks.onProgress).toHaveBeenLastCalledWith(hash, 2, 3);
        expect(frame(receiver.sent.at(-1)!).missingChunks).toEqual([2]);
        const repair = receiver.sent.at(-1)!;
        sender.sent.length = 0;
        await sender.transfer.handleMessage('receiver', repair);
        const controls = sender.sent.map(frame);
        const chunks = controls.filter((value) => value.type === 'asset.chunk');
        expect(chunks.map((value) => value.index)).toEqual([2]);
        for (const message of sender.sent) {
            await receiver.transfer.handleMessage('sender', message);
        }
        await receiver.completion;
        expect(new Uint8Array(await receiver.transfer.getAsset(hash)!.arrayBuffer())).toEqual(bytes);
    });

    it('bounds repeated bad-index repair generations and ignores stale repair frames', async () => {
        const { sender, receiver, hash } = await fixture();
        await receiver.transfer.handleMessage('sender', sender.sent[1]!);
        const missingDigest = rewrite(sender.sent[2]!, (value) => {
            delete value.digest;
        });
        await receiver.transfer.handleMessage('sender', missingDigest);
        const firstRepair = receiver.sent.at(-1)!;
        for (let generation = 1; generation <= ASSET_REQUEST_MAX_ATTEMPTS; generation++) {
            const before = receiver.sent.length;
            await receiver.transfer.handleMessage('sender', missingDigest);
            expect(receiver.sent).toHaveLength(before);
            const current = frame(receiver.sent.at(-1)!).repairSequence;
            await receiver.transfer.handleMessage(
                'sender',
                rewrite(missingDigest, (value) => {
                    value.repairSequence = current;
                })
            );
        }
        expect(receiver.sent.map(frame).filter((value) => value.repairSequence !== undefined)).toHaveLength(
            ASSET_REQUEST_MAX_ATTEMPTS
        );
        expect(frame(firstRepair).missingChunks).toEqual([1]);
        expect(receiver.callbacks.onTransferFailed).toHaveBeenCalledTimes(1);
        expect(receiver.callbacks.onTransferFailed.mock.calls[0]?.[1]).toContain(
            'failed its integrity check repeatedly'
        );
        expect(receiver.callbacks.onProgress).toHaveBeenCalledExactlyOnceWith(hash, 1, 3);
        expect(await journalState()).toEqual({ received: [[0]], chunks: 1 });
    });

    it('keeps only the latest same-attempt repair behind sender backpressure without skipping original required chunks', async () => {
        const { sender, receiver, hash } = await fixture();
        const started = Promise.withResolvers<void>();
        const release = Promise.withResolvers<void>();
        sender.sent.length = 0;
        let held = false;
        vi.mocked(sender.peer.sendCrdtSyncBuffered).mockImplementation(async ({ message }) => {
            sender.sent.push(message);
            if (!held) {
                held = true;
                started.resolve();
                await release.promise;
            }
        });
        const original = receiver.sent[0]!;
        const serving = sender.transfer.handleMessage('receiver', original);
        await started.promise;
        const firstRepair = rewrite(original, (value) => {
            value.repairSequence = 1;
            value.missingChunks = [1];
        });
        const latestRepair = rewrite(original, (value) => {
            value.repairSequence = 2;
            value.missingChunks = [2, 2, -1, 99999];
        });
        await sender.transfer.handleMessage('receiver', firstRepair);
        await sender.transfer.handleMessage('receiver', latestRepair);
        for (let duplicate = 0; duplicate < 100; duplicate++) {
            await sender.transfer.handleMessage('receiver', duplicate % 2 === 0 ? firstRepair : latestRepair);
        }
        expect(sender.sent.map(frame).filter((value) => value.type === 'asset.chunk')).toHaveLength(1);
        release.resolve();
        await serving;
        const controls = sender.sent.map(frame);
        expect(controls.filter((value) => value.type === 'asset.manifest')).toHaveLength(2);
        expect(
            controls.filter((value) => value.type === 'asset.chunk').map((value) => [value.index, value.repairSequence])
        ).toEqual([
            [0, undefined],
            [1, undefined],
            [2, undefined],
            [2, 2],
        ]);
        for (const message of sender.sent) {
            await receiver.transfer.handleMessage('sender', message);
        }
        await receiver.completion;
        expect(receiver.callbacks.onAssetAvailable).toHaveBeenCalledExactlyOnceWith(hash);
    });

    it('reports quota refusal without advancing verified progress or claiming durability', async () => {
        const { sender, receiver, hash } = await fixture();
        const nativePut = IDBObjectStore.prototype.put;
        const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
            this: IDBObjectStore,
            ...args
        ) {
            if (this.name === ASSET_RESUME_CHUNKS) {
                throw new DOMException('Controlled wire quota refusal', 'QuotaExceededError');
            }
            return nativePut.apply(this, args);
        });
        await receiver.transfer.handleMessage('sender', sender.sent[1]!);
        put.mockRestore();
        expect(receiver.callbacks.onTransferFailed).toHaveBeenCalledTimes(1);
        expect(receiver.callbacks.onTransferFailed.mock.calls[0]?.[1]).toContain('Controlled wire quota refusal');
        expect(receiver.callbacks.onProgress).not.toHaveBeenCalled();
        expect(receiver.callbacks.onAssetAvailable).not.toHaveBeenCalled();
        expect(receiver.transfer.hasAsset(hash)).toBe(false);
        expect(await journalState()).toEqual({ received: [[]], chunks: 0 });
    });
});
