import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    ASSET_CHUNK_SIZE,
    ASSET_REQUEST_MAX_ATTEMPTS,
    ASSET_REQUEST_RETRY_COOLDOWN_MS,
} from '../../models/CollaborationTypes';
import { type PeerMessage } from '../../models/CollaborationTypes';
import { type PeerConnectionManager } from '../../repositories/peerConnection';
import { AssetTransfer, ASSET_TRANSFER_STALL_TIMEOUT_MS } from '../assetTransfer';

beforeEach(() => {
    vi.stubGlobal('indexedDB', new IDBFactory());
    vi.stubGlobal('IDBKeyRange', IDBKeyRange);
});
const instances: AssetTransfer[] = [];
afterEach(() => {
    for (const instance of instances.splice(0)) {
        instance.dispose();
    }
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

function endpoint(owner = 'project:A') {
    const sent: PeerMessage[] = [];
    const requests: Array<() => void> = [];
    let blocked: Promise<void> | undefined;
    let manifestBlocked: Promise<void> | undefined;
    let manifestStarted: (() => void) | undefined;
    let bufferedStarted: (() => void) | undefined;
    function record({ message }: { message: PeerMessage }) {
        sent.push(message);
        manifestStarted?.();
        manifestStarted = undefined;
        return manifestBlocked ?? Promise.resolve();
    }
    function recordBuffered(input: { message: PeerMessage }) {
        sent.push(input.message);
        bufferedStarted?.();
        bufferedStarted = undefined;
        return blocked ?? Promise.resolve();
    }
    const peer = {
        // This fixture retains the pre-integrity protocol's same-session contract.
        // The separate restart/integrity specs negotiate production v1 frames.
        broadcastCrdtSync: (message: PeerMessage) => {
            sent.push(
                rewrite(message, (frame) => {
                    delete frame.integrityVersion;
                })
            );
            requests.shift()?.();
        },
        sendCrdtSync: record,
        sendCrdtSyncBuffered: recordBuffered,
    } as unknown as PeerConnectionManager;
    let available!: () => void;
    const completion = new Promise<void>((resolve) => {
        available = resolve;
    });
    const callbacks = { onAssetAvailable: vi.fn(available), onProgress: vi.fn(), onTransferFailed: vi.fn() };
    const transfer = new AssetTransfer(peer, callbacks, owner);
    instances.push(transfer);
    return {
        transfer,
        sent,
        callbacks,
        completion,
        request: (hash: string) => {
            const emitted = new Promise<void>((resolve) => requests.push(resolve));
            transfer.requestAsset(hash);
            return emitted;
        },
        block: (promise?: Promise<void>) => {
            blocked = promise;
        },
        nextBuffered: () =>
            new Promise<void>((resolve) => {
                bufferedStarted = resolve;
            }),
        blockManifest: (promise?: Promise<void>) => {
            manifestBlocked = promise;
        },
        nextManifest: () =>
            new Promise<void>((resolve) => {
                manifestStarted = resolve;
            }),
    };
}

function control(message: PeerMessage) {
    if (message.type !== 'crdt-sync') {
        throw new Error('Expected asset wire frame');
    }
    const frame: unknown = JSON.parse(message.data);
    if (!isRecord(frame)) {
        throw new Error('Expected control object');
    }
    return frame;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function fixture(priorFailures = 0) {
    const sender = endpoint();
    const receiver = endpoint();
    const bytes = new Uint8Array(ASSET_CHUNK_SIZE * 2 + 17);
    for (let index = 0; index < bytes.length; index++) {
        bytes[index] = index % 251;
    }
    const blob = new Blob([bytes], { type: 'audio/wav' });
    const hash = await sender.transfer.addLocalAsset(blob, 'take.wav');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    for (let attempt = 0; attempt < priorFailures; attempt++) {
        await receiver.request(hash);
        vi.advanceTimersByTime(ASSET_TRANSFER_STALL_TIMEOUT_MS + ASSET_REQUEST_RETRY_COOLDOWN_MS);
    }
    await receiver.request(hash);
    await sender.transfer.handleMessage('receiver', receiver.sent.at(-1)!);
    expect(sender.sent).toHaveLength(4);
    await receiver.transfer.handleMessage('A', sender.sent[0]!);
    await receiver.transfer.handleMessage('A', sender.sent[1]!);
    expect(receiver.callbacks.onProgress).toHaveBeenLastCalledWith(hash, 1, 3);
    return { sender, receiver, hash, bytes, blob };
}

async function retry(receiver: ReturnType<typeof endpoint>, hash: string) {
    vi.advanceTimersByTime(ASSET_TRANSFER_STALL_TIMEOUT_MS);
    vi.advanceTimersByTime(ASSET_REQUEST_RETRY_COOLDOWN_MS);
    await receiver.request(hash);
    return receiver.sent.at(-1)!;
}

function rewrite(message: PeerMessage, update: (frame: ReturnType<typeof control>) => void): PeerMessage {
    if (message.type !== 'crdt-sync') {
        throw new Error('Expected asset wire frame');
    }
    const frame = control(message);
    update(frame);
    return { ...message, data: JSON.stringify(frame) };
}

async function rebind(transfer: AssetTransfer, owner: string) {
    const handoff = await transfer.prepareDurableOwnerRebind(owner);
    if (handoff.status !== 'prepared') {
        throw new Error('Expected prepared owner handoff');
    }
    expect(await handoff.commit()).toMatchObject({ status: 'committed' });
}

describe('same-session legacy compatibility over serialized peer frames', () => {
    it('requests only actual missing indices and verifies the exact completed bytes', async () => {
        const { sender, receiver, hash, bytes } = await fixture();
        const request = await retry(receiver, hash);
        expect(control(request).missingChunks).toEqual([1, 2]);
        expect(control(request).attemptToken).not.toBe(control(receiver.sent[0]!).attemptToken);
        sender.sent.length = 0;
        await sender.transfer.handleMessage('receiver', request);
        const chunks = sender.sent.map(control).filter((frame) => frame.type === 'asset.chunk');
        expect(chunks.map((frame) => frame.index)).toEqual([1, 2]);
        for (const message of sender.sent) {
            await receiver.transfer.handleMessage('A', message);
        }
        await receiver.completion;
        expect(receiver.callbacks.onAssetAvailable).toHaveBeenCalledExactlyOnceWith(hash);
        expect(new Uint8Array(await receiver.transfer.getAsset(hash)!.arrayBuffer())).toEqual(bytes);
    });

    it.each(['other-peer', 'legacy', 'geometry'] as const)(
        'retires incompatible %s resume once, then sends a fresh full request after cooldown',
        async (kind) => {
            const { sender, receiver, hash, blob, bytes } = await fixture();
            const alternate = endpoint();
            await alternate.transfer.addLocalAsset(blob, 'take.wav');
            const request = await retry(receiver, hash);
            expect(control(request).missingChunks).toEqual([1, 2]);
            const responder = kind === 'other-peer' ? alternate : sender;
            responder.sent.length = 0;
            const legacyRequest = rewrite(request, (frame) => {
                delete frame.attemptToken;
            });
            await responder.transfer.handleMessage('receiver', kind === 'legacy' ? legacyRequest : request);
            let manifest = responder.sent[0]!;
            if (kind === 'geometry') {
                manifest = rewrite(manifest, (frame) => {
                    const geometry = frame.manifest;
                    if (!isRecord(geometry) || typeof geometry.chunkSize !== 'number') {
                        throw new TypeError('Expected chunk geometry');
                    }
                    geometry.chunkSize /= 2;
                    geometry.chunkCount = 5;
                });
            }
            const responderId = kind === 'other-peer' ? 'B' : 'A';
            receiver.callbacks.onProgress.mockClear();
            await receiver.transfer.handleMessage(responderId, manifest);
            expect(receiver.callbacks.onTransferFailed).toHaveBeenCalledTimes(2);
            expect(receiver.callbacks.onTransferFailed.mock.calls.at(-1)?.[2]).toBe('cooldown');
            for (const chunk of responder.sent.slice(1)) {
                await receiver.transfer.handleMessage(responderId, chunk);
            }
            expect(receiver.callbacks.onProgress).not.toHaveBeenCalled();
            expect(receiver.callbacks.onAssetAvailable).not.toHaveBeenCalled();
            for (let tick = 0; tick < 100; tick++) {
                receiver.transfer.requestAsset(hash);
            }
            expect(receiver.sent).toHaveLength(2);
            vi.advanceTimersByTime(ASSET_REQUEST_RETRY_COOLDOWN_MS - 1);
            receiver.transfer.requestAsset(hash);
            expect(receiver.sent).toHaveLength(2);
            vi.advanceTimersByTime(1);
            await receiver.request(hash);
            const fullRequest = receiver.sent.at(-1)!;
            expect(control(fullRequest).missingChunks).toEqual([]);
            expect(control(fullRequest).attemptToken).not.toBe(control(request).attemptToken);
            responder.sent.length = 0;
            let fullWireRequest = fullRequest;
            if (kind === 'legacy') {
                fullWireRequest = rewrite(fullRequest, (frame) => {
                    delete frame.attemptToken;
                });
            }
            await responder.transfer.handleMessage('receiver', fullWireRequest);
            for (const message of responder.sent) {
                await receiver.transfer.handleMessage(responderId, message);
            }
            await receiver.completion;
            expect(new Uint8Array(await receiver.transfer.getAsset(hash)!.arrayBuffer())).toEqual(bytes);
        }
    );

    it.each(['B', 'legacy'] as const)(
        'spends the last attempt on incompatible %s manifest without another request',
        async (kind) => {
            const { sender, receiver, hash, blob } = await fixture(ASSET_REQUEST_MAX_ATTEMPTS - 2);
            const alternate = endpoint();
            await alternate.transfer.addLocalAsset(blob, 'take.wav');
            const responder = kind === 'B' ? alternate : sender;
            const request = await retry(receiver, hash);
            responder.sent.length = 0;
            let wireRequest = request;
            if (kind === 'legacy') {
                wireRequest = rewrite(request, (frame) => {
                    delete frame.attemptToken;
                });
            }
            await responder.transfer.handleMessage('receiver', wireRequest);
            await receiver.transfer.handleMessage(kind === 'B' ? 'B' : 'A', responder.sent[0]!);
            expect(receiver.callbacks.onTransferFailed).toHaveBeenCalledTimes(ASSET_REQUEST_MAX_ATTEMPTS);
            expect(receiver.callbacks.onTransferFailed.mock.calls.at(-1)?.[2]).toBe('abandoned');
            const requests = receiver.sent.length;
            vi.advanceTimersByTime(ASSET_TRANSFER_STALL_TIMEOUT_MS + ASSET_REQUEST_RETRY_COOLDOWN_MS * 10);
            receiver.transfer.requestAsset(hash);
            expect(receiver.sent).toHaveLength(requests);
            expect(vi.getTimerCount()).toBe(0);
        }
    );

    it('ignores stale, malformed, wrong-hash and wrong-peer frames before budget or deadline changes', async () => {
        const { sender, receiver, hash } = await fixture();
        const old = [...sender.sent];
        const request = await retry(receiver, hash);
        sender.sent.length = 0;
        await sender.transfer.handleMessage('receiver', request);
        await receiver.transfer.handleMessage('A', sender.sent[0]!);
        receiver.callbacks.onProgress.mockClear();
        vi.advanceTimersByTime(ASSET_TRANSFER_STALL_TIMEOUT_MS - 1);
        for (const message of old) {
            await receiver.transfer.handleMessage('A', message);
        }
        await receiver.transfer.handleMessage(
            'A',
            rewrite(sender.sent[1]!, (frame) => {
                frame.attemptToken = 'malformed';
                frame.index = -1;
            })
        );
        await receiver.transfer.handleMessage(
            'A',
            rewrite(sender.sent[1]!, (frame) => {
                frame.hash = 'unsolicited';
                frame.index = -1;
            })
        );
        await receiver.transfer.handleMessage(
            'B',
            rewrite(sender.sent[1]!, (frame) => {
                frame.index = -1;
            })
        );
        expect(receiver.callbacks.onProgress).not.toHaveBeenCalled();
        expect(receiver.callbacks.onTransferFailed).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(1);
        expect(receiver.callbacks.onTransferFailed).toHaveBeenCalledTimes(2);
        expect(receiver.callbacks.onAssetAvailable).not.toHaveBeenCalled();
    });

    it('expires partial bytes when the scheduler stops requesting and clears disposal timers', async () => {
        const { receiver, hash } = await fixture();
        vi.advanceTimersByTime(ASSET_TRANSFER_STALL_TIMEOUT_MS);
        expect(vi.getTimerCount()).toBe(1);
        vi.advanceTimersByTime(ASSET_REQUEST_RETRY_COOLDOWN_MS + ASSET_TRANSFER_STALL_TIMEOUT_MS);
        expect(vi.getTimerCount()).toBe(0);
        await receiver.request(hash);
        expect(control(receiver.sent.at(-1)!).missingChunks).toEqual([]);
        receiver.transfer.dispose();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('drops corrupted retained bytes after the mandatory final whole-asset digest fails', async () => {
        const { sender, receiver, hash } = await fixture();
        const request = await retry(receiver, hash);
        sender.sent.length = 0;
        await sender.transfer.handleMessage('receiver', request);
        for (const message of sender.sent) {
            let changed = message;
            if (control(message).type === 'asset.chunk') {
                changed = rewrite(message, (frame) => {
                    if (typeof frame.data !== 'string') {
                        throw new TypeError('Expected encoded chunk');
                    }
                    const data = atob(frame.data);
                    frame.data = btoa(String.fromCharCode(data.charCodeAt(0) ^ 1) + data.slice(1));
                });
            }
            await receiver.transfer.handleMessage('A', changed);
        }
        await vi.waitFor(() => expect(receiver.callbacks.onTransferFailed).toHaveBeenCalledTimes(2));
        expect(receiver.callbacks.onTransferFailed.mock.calls.at(-1)?.[1]).toContain('integrity check failed');
        expect(receiver.transfer.hasAsset(hash)).toBe(false);
        vi.advanceTimersByTime(ASSET_REQUEST_RETRY_COOLDOWN_MS);
        await receiver.request(hash);
        expect(control(receiver.sent.at(-1)!).missingChunks).toEqual([]);
    });

    it('invalidates a real owner handoff, preserves accepted assets, and refuses the reverse canonical-owner cycle', async () => {
        const { receiver, hash } = await fixture();
        const accepted = await receiver.transfer.addLocalAsset(new Blob(['accepted']), 'accepted.wav');
        const staged = await receiver.transfer.stageDurableAsset(
            new Blob(['durable']),
            'durable.wav',
            'resume-test-stage'
        );
        expect(await receiver.transfer.promoteDurableStagedAsset(staged.leaseId, staged.hash)).toMatchObject({
            status: 'promoted',
        });
        vi.advanceTimersByTime(ASSET_TRANSFER_STALL_TIMEOUT_MS);
        await rebind(receiver.transfer, 'project:B');
        const reverse = await receiver.transfer.prepareDurableOwnerRebind('project:A');
        if (reverse.status !== 'prepared') {
            throw new Error('Expected journaled reverse attempt');
        }
        expect(await reverse.commit()).toMatchObject({
            status: 'retry-required',
            phase: 'commit',
            error: new Error('Durable asset owner rebind failed: owner-handoff-conflict'),
        });
        expect(receiver.transfer.hasAsset(accepted)).toBe(true);
        expect(await receiver.transfer.reopenDurableAsset(staged.hash)).toMatchObject({ status: 'opened' });
        await receiver.request(hash);
        expect(control(receiver.sent.at(-1)!).missingChunks).toEqual([]);
    });

    it.each(['dispose', 'rebind'] as const)(
        'fences a delayed digest after %s and admits only a fresh full transfer',
        async (mode) => {
            const { sender, receiver, hash } = await fixture();
            const digestStarted = Promise.withResolvers<void>();
            const releaseDigest = Promise.withResolvers<void>();
            const nativeDigest = crypto.subtle.digest.bind(crypto.subtle);
            const digest = vi.spyOn(crypto.subtle, 'digest').mockImplementation(async (...args) => {
                digestStarted.resolve();
                await releaseDigest.promise;
                return nativeDigest(...args);
            });
            for (const message of sender.sent.slice(2)) {
                await receiver.transfer.handleMessage('A', message);
            }
            await digestStarted.promise;
            let successor = receiver;
            if (mode === 'dispose') {
                receiver.transfer.dispose();
                successor = endpoint('project:A');
            } else {
                await rebind(receiver.transfer, 'project:B');
            }
            releaseDigest.resolve();
            await digest.mock.results[0]!.value;
            await vi.advanceTimersByTimeAsync(0);
            await successor.request(hash);
            for (const message of sender.sent) {
                await successor.transfer.handleMessage('A', message);
            }
            expect(receiver.callbacks.onAssetAvailable).not.toHaveBeenCalled();
            expect(successor.callbacks.onAssetAvailable).not.toHaveBeenCalled();
            expect(successor.transfer.hasAsset(hash)).toBe(false);
            expect(control(successor.sent.at(-1)!).missingChunks).toEqual([]);
            sender.sent.length = 0;
            await sender.transfer.handleMessage('receiver', successor.sent.at(-1)!);
            for (const message of sender.sent) {
                await successor.transfer.handleMessage('A', message);
            }
            await successor.completion;
            expect(successor.callbacks.onAssetAvailable).toHaveBeenCalledExactlyOnceWith(hash);
            digest.mockRestore();
        }
    );

    it('serves only the bounded latest successor after buffered backpressure settles', async () => {
        const { sender, receiver, hash } = await fixture();
        sender.sent.length = 0;
        const release = Promise.withResolvers<void>();
        sender.block(release.promise);
        const started = sender.nextBuffered();
        const firstRequest = receiver.sent[0]!;
        const serving = sender.transfer.handleMessage('receiver', firstRequest);
        await started;
        const request = await retry(receiver, hash);
        await sender.transfer.handleMessage('receiver', request);
        const latest = rewrite(request, (frame) => {
            frame.attemptToken = crypto.randomUUID();
            frame.missingChunks = [2, 2, -1, 99999];
        });
        for (let index = 0; index < 50; index++) {
            await sender.transfer.handleMessage('receiver', latest);
        }
        expect(sender.sent.map(control).filter((frame) => frame.type === 'asset.chunk')).toHaveLength(1);
        sender.block();
        release.resolve();
        await serving;
        const frames = sender.sent.map(control);
        expect(frames.filter((frame) => frame.type === 'asset.manifest')).toHaveLength(2);
        expect(
            frames.filter((frame) => frame.type === 'asset.chunk').map((frame) => [frame.attemptToken, frame.index])
        ).toEqual([
            [control(firstRequest).attemptToken, 0],
            [control(latest).attemptToken, 2],
        ]);
    });

    it('stops sending after dispose while a buffered chunk is already in flight', async () => {
        const { sender, receiver } = await fixture();
        sender.sent.length = 0;
        const release = Promise.withResolvers<void>();
        sender.block(release.promise);
        const started = sender.nextBuffered();
        const serving = sender.transfer.handleMessage('receiver', receiver.sent[0]!);
        await started;
        expect(sender.sent).toHaveLength(2);
        sender.transfer.dispose();
        release.resolve();
        await serving;
        expect(sender.sent).toHaveLength(2);
    });

    it('keeps an untagged peer on the full-transfer retry path', async () => {
        const sender = endpoint();
        const receiver = endpoint();
        const bytes = new Uint8Array(ASSET_CHUNK_SIZE * 2 + 17).fill(37);
        const hash = await sender.transfer.addLocalAsset(new Blob([bytes]), 'legacy.wav');
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
        await receiver.request(hash);
        function legacy(message: PeerMessage) {
            return rewrite(message, (frame) => {
                delete frame.attemptToken;
            });
        }
        await sender.transfer.handleMessage('receiver', legacy(receiver.sent[0]!));
        await receiver.transfer.handleMessage('legacy', sender.sent[0]!);
        await receiver.transfer.handleMessage('legacy', sender.sent[1]!);
        const request = await retry(receiver, hash);
        expect(control(request).missingChunks).toEqual([]);
        sender.sent.length = 0;
        await sender.transfer.handleMessage('receiver', legacy(request));
        for (const message of sender.sent) {
            await receiver.transfer.handleMessage('legacy', message);
        }
        await receiver.completion;
        expect(receiver.callbacks.onAssetAvailable).toHaveBeenCalledExactlyOnceWith(hash);
    });

    it('does not replace retained bytes with a duplicate chunk payload', async () => {
        const { sender, receiver, hash } = await fixture();
        await receiver.transfer.handleMessage(
            'A',
            rewrite(sender.sent[1]!, (frame) => {
                frame.data = btoa('z'.repeat(ASSET_CHUNK_SIZE));
            })
        );
        const request = await retry(receiver, hash);
        sender.sent.length = 0;
        await sender.transfer.handleMessage('receiver', request);
        for (const message of sender.sent) {
            await receiver.transfer.handleMessage('A', message);
        }
        await receiver.completion;
        expect(receiver.callbacks.onAssetAvailable).toHaveBeenCalledExactlyOnceWith(hash);
    });

    it('checks the response generation after a manifest await before sending a chunk', async () => {
        const { sender, receiver, hash } = await fixture();
        sender.sent.length = 0;
        const release = Promise.withResolvers<void>();
        sender.blockManifest(release.promise);
        const started = sender.nextManifest();
        const serving = sender.transfer.handleMessage('receiver', receiver.sent[0]!);
        await started;
        const request = await retry(receiver, hash);
        await sender.transfer.handleMessage('receiver', request);
        expect(sender.sent).toHaveLength(1);
        sender.blockManifest();
        release.resolve();
        await serving;
        const chunks = sender.sent.map(control).filter((frame) => frame.type === 'asset.chunk');
        expect(chunks.map((frame) => frame.index)).toEqual([1, 2]);
        expect(chunks.every((frame) => frame.attemptToken === control(request).attemptToken)).toBe(true);
    });

    it('checks the response generation after reading a chunk before sending its bytes', async () => {
        const { sender, receiver, hash } = await fixture();
        sender.sent.length = 0;
        const readStarted = Promise.withResolvers<void>();
        const releaseRead = Promise.withResolvers<void>();
        const nativeSlice = Blob.prototype.slice;
        let held = false;
        const slice = vi.spyOn(Blob.prototype, 'slice').mockImplementation(function (this: Blob, ...args) {
            const result = nativeSlice.apply(this, args);
            if (!held) {
                held = true;
                const nativeRead = result.arrayBuffer.bind(result);
                result.arrayBuffer = async () => {
                    readStarted.resolve();
                    await releaseRead.promise;
                    return nativeRead();
                };
            }
            return result;
        });
        const serving = sender.transfer.handleMessage('receiver', receiver.sent[0]!);
        await readStarted.promise;
        const request = await retry(receiver, hash);
        await sender.transfer.handleMessage('receiver', request);
        releaseRead.resolve();
        await serving;
        const chunks = sender.sent.map(control).filter((frame) => frame.type === 'asset.chunk');
        expect(chunks.map((frame) => frame.index)).toEqual([1, 2]);
        expect(chunks.every((frame) => frame.attemptToken === control(request).attemptToken)).toBe(true);
        slice.mockRestore();
    });
});
