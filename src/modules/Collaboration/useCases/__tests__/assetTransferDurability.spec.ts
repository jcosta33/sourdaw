import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { DOC_ID_ASSET } from '../../models/SyncChannelConstants';
import { createDurableAssetRepository } from '../../repositories/durableAssetRepository';
import { type PeerConnectionManager } from '../../repositories/peerConnection';
import { AssetTransfer } from '../assetTransfer';

import { installFakeDurableAssetIndexedDb, type FakeDurableAssetIndexedDb } from './fakeDurableAssetIndexedDb';

let durableAssetIndexedDb: FakeDurableAssetIndexedDb;
const TEST_OWNER = 'project:test';

beforeAll(() => {
    durableAssetIndexedDb = installFakeDurableAssetIndexedDb();
});

function makePeerManager(): PeerConnectionManager {
    return {
        broadcastCrdtSync: vi.fn(),
        sendCrdtSync: vi.fn(),
        sendCrdtSyncBuffered: vi.fn(),
    } as unknown as PeerConnectionManager;
}

describe('AssetTransfer durable ownership', () => {
    let peer: PeerConnectionManager;
    let onAssetAvailable: Mock<(hash: string) => void>;
    let onProgress: Mock<(hash: string, receivedChunks: number, totalChunks: number) => void>;
    let onTransferFailed: Mock<(hash: string, reason: string) => void>;
    let transfer: AssetTransfer;

    beforeEach(() => {
        durableAssetIndexedDb.reset();
        peer = makePeerManager();
        onAssetAvailable = vi.fn<(hash: string) => void>();
        onProgress = vi.fn<(hash: string, receivedChunks: number, totalChunks: number) => void>();
        onTransferFailed = vi.fn<(hash: string, reason: string) => void>();
        transfer = new AssetTransfer(peer, { onAssetAvailable, onProgress, onTransferFailed }, TEST_OWNER);
    });

    afterEach(() => {
        // Every test leaves at most one instance; disposing clears any armed
        // stall timer so a later test's fake clock can't inherit it.
        transfer.dispose();
        vi.useRealTimers();
    });

    it('addLocalAsset hashes and keeps a session-resident blob', async () => {
        const blob = new Blob(['hello'], { type: 'text/plain' });
        const hash = await transfer.addLocalAsset(blob, 'hello.txt');

        expect(hash.startsWith('sha256:')).toBe(true);
        expect(transfer.hasAsset(hash)).toBe(true);
        expect(transfer.getAsset(hash)).toBe(blob);
    });

    it('does not mint persistent ownership for an ordinary session-local asset', async () => {
        const hash = await transfer.addLocalAsset(new Blob(['resident-only']), 'resident.wav');
        transfer.dispose();
        const recreated = new AssetTransfer(peer, { onAssetAvailable, onProgress, onTransferFailed }, TEST_OWNER);

        await expect(recreated.reopenDurableAsset(hash)).resolves.toEqual({
            status: 'failed',
            reason: 'missing-asset',
        });
        recreated.dispose();
    });

    it('keeps durable staging closed until a join owner handoff has persisted', async () => {
        const joining = new AssetTransfer(
            peer,
            { onAssetAvailable, onProgress, onTransferFailed },
            'collaboration-join:durable-gate',
            undefined,
            { durableStagingReady: false }
        );

        await expect(
            joining.stageDurableAsset(new Blob(['not-yet-owned']), 'gated.wav', 'asset-stage-gated')
        ).rejects.toThrow('until synchronized owner persistence completes');
        await expect(joining.stageLocalAsset(new Blob(['session-staging']), 'session.wav')).resolves.toMatchObject({
            leaseId: expect.stringMatching(/^asset-stage-/u),
        });

        await joining.prepareDurableOwnerRebind('project:durable-ready');
        await joining.commitDurableOwnerRebind('project:durable-ready');
        await expect(
            joining.stageDurableAsset(new Blob(['now-owned']), 'ready.wav', 'asset-stage-ready')
        ).resolves.toMatchObject({ leaseId: 'asset-stage-ready' });
        joining.dispose();
    });

    it('stages duplicate content without claiming ownership of the existing asset', async () => {
        const existing = new Blob(['same-content'], { type: 'text/plain' });
        const duplicate = new Blob(['same-content'], { type: 'text/plain' });
        const committed = await transfer.stageDurableAsset(existing, 'existing.txt', 'asset-stage-existing');
        await transfer.promoteDurableStagedAsset(committed.leaseId, committed.hash);
        const existingHash = committed.hash;

        const staged = await transfer.stageDurableAsset(duplicate, 'duplicate.txt', 'asset-stage-duplicate');

        expect(staged).toEqual({ hash: existingHash, leaseId: expect.stringMatching(/^asset-stage-/u) });
        expect(transfer.getAsset(existingHash)).toBe(duplicate);
    });

    it('replaces a corrupt same-hash durable record with the verified staging input before leasing it', async () => {
        const input = new Blob(['verified-restage'], { type: 'audio/wav' });
        const original = await transfer.stageDurableAsset(input, 'original.wav', 'asset-stage-corrupt-original');
        durableAssetIndexedDb.overwriteAssetBlob(original.hash, new Blob(['corrupt-bytes']));

        const restaged = await transfer.stageDurableAsset(
            new Blob(['verified-restage']),
            'restaged.wav',
            'asset-stage-corrupt-restage'
        );

        await expect(transfer.reopenDurableStagedAsset(restaged.leaseId, restaged.hash)).resolves.toMatchObject({
            status: 'opened',
            hash: restaged.hash,
        });
    });

    it('cannot serve finally released bytes from another live transfer cache', async () => {
        const staged = await transfer.stageDurableAsset(
            new Blob(['shared-live-cache']),
            'shared.wav',
            'asset-stage-shared-live'
        );
        const durableAssets = createDurableAssetRepository(TEST_OWNER);
        const otherTransfer = new AssetTransfer(peer, { onAssetAvailable, onProgress, onTransferFailed }, TEST_OWNER, {
            ...durableAssets,
            subscribeInvalidation: () => () => undefined,
        });
        await otherTransfer.reopenDurableStagedAsset(staged.leaseId, staged.hash);
        expect(otherTransfer.hasAsset(staged.hash)).toBe(true);

        await transfer.releaseDurableStagedAsset(staged.leaseId, staged.hash);
        expect(otherTransfer.hasAsset(staged.hash)).toBe(true);
        await otherTransfer.handleMessage('requester', {
            type: 'crdt-sync',
            docId: DOC_ID_ASSET,
            data: JSON.stringify({ type: 'asset.request', hash: staged.hash, missingChunks: [] }),
        });

        expect(otherTransfer.hasAsset(staged.hash)).toBe(false);
        expect(peer.sendCrdtSync).not.toHaveBeenCalled();
        otherTransfer.dispose();
    });

    it('does not serve a staged original to a peer before project ownership is promoted', async () => {
        const staged = await transfer.stageDurableAsset(
            new Blob(['private-staged-original']),
            'private-staged.wav',
            'asset-stage-private-peer'
        );

        await expect(transfer.reopenDurableStagedAsset(staged.leaseId, staged.hash)).resolves.toMatchObject({
            status: 'opened',
            leaseState: 'staged',
        });
        await transfer.handleMessage('requester', {
            type: 'crdt-sync',
            docId: DOC_ID_ASSET,
            data: JSON.stringify({ type: 'asset.request', hash: staged.hash, missingChunks: [] }),
        });

        expect(peer.sendCrdtSync).not.toHaveBeenCalled();
    });

    it('does not evict a newly restaged cache entry when an old release is retried', async () => {
        const first = await transfer.stageDurableAsset(
            new Blob(['restaged-content']),
            'first.wav',
            'asset-stage-old-release'
        );
        await transfer.releaseDurableStagedAsset(first.leaseId, first.hash);
        const second = await transfer.stageDurableAsset(
            new Blob(['restaged-content']),
            'second.wav',
            'asset-stage-new-release'
        );

        await transfer.releaseDurableStagedAsset(first.leaseId, first.hash);

        expect(transfer.hasAsset(second.hash)).toBe(true);
        await expect(transfer.reopenDurableStagedAsset(second.leaseId, second.hash)).resolves.toMatchObject({
            status: 'opened',
        });
    });

    it('rejects a valid lease when promote or release is bound to another valid asset hash', async () => {
        const first = await transfer.stageDurableAsset(
            new Blob(['first-valid']),
            'first.wav',
            'asset-stage-valid-first'
        );
        const second = await transfer.stageDurableAsset(
            new Blob(['second-valid']),
            'second.wav',
            'asset-stage-valid-second'
        );

        await expect(transfer.promoteDurableStagedAsset(first.leaseId, second.hash)).resolves.toEqual({
            status: 'failed',
            reason: 'lease-hash-mismatch',
        });
        await expect(transfer.releaseDurableStagedAsset(first.leaseId, second.hash)).resolves.toEqual({
            status: 'failed',
            reason: 'lease-hash-mismatch',
        });
    });

    it('leaves an entire staged set untouched when one atomic release binding is wrong', async () => {
        const first = await transfer.stageDurableAsset(
            new Blob(['atomic-first']),
            'atomic-first.wav',
            'asset-stage-atomic-first'
        );
        const second = await transfer.stageDurableAsset(
            new Blob(['atomic-second']),
            'atomic-second.wav',
            'asset-stage-atomic-second'
        );

        await expect(
            transfer.releaseDurableStagedAssets([
                { leaseId: first.leaseId, expectedHash: first.hash },
                { leaseId: second.leaseId, expectedHash: first.hash },
            ])
        ).resolves.toEqual({ status: 'failed', reason: 'lease-hash-mismatch' });
        await expect(transfer.reopenDurableStagedAsset(first.leaseId, first.hash)).resolves.toMatchObject({
            status: 'opened',
        });
        await expect(transfer.reopenDurableStagedAsset(second.leaseId, second.hash)).resolves.toMatchObject({
            status: 'opened',
        });

        await expect(
            transfer.releaseDurableStagedAssets([
                { leaseId: first.leaseId, expectedHash: first.hash },
                { leaseId: second.leaseId, expectedHash: second.hash },
            ])
        ).resolves.toMatchObject({ status: 'released', releases: [{ status: 'released' }, { status: 'released' }] });
    });

    it('retries a caller-known lease identity after storage commits but handoff faults', async () => {
        const durableAssets = createDurableAssetRepository(TEST_OWNER);
        let injectHandoffFault = true;
        const faultyAssets = {
            ...durableAssets,
            stageAsset: async (...input: Parameters<typeof durableAssets.stageAsset>) => {
                const staged = await durableAssets.stageAsset(...input);
                if (injectHandoffFault) {
                    injectHandoffFault = false;
                    throw new Error('fault after durable commit');
                }
                return staged;
            },
        };
        const faultingTransfer = new AssetTransfer(
            peer,
            { onAssetAvailable, onProgress, onTransferFailed },
            TEST_OWNER,
            faultyAssets
        );

        await expect(
            faultingTransfer.stageDurableAsset(
                new Blob(['idempotent-handoff']),
                'handoff.wav',
                'asset-stage-known-operation'
            )
        ).rejects.toThrow('fault after durable commit');
        faultingTransfer.dispose();

        const retriedTransfer = new AssetTransfer(
            peer,
            { onAssetAvailable, onProgress, onTransferFailed },
            TEST_OWNER,
            durableAssets
        );
        const retried = await retriedTransfer.stageDurableAsset(
            new Blob(['idempotent-handoff']),
            'handoff.wav',
            'asset-stage-known-operation'
        );

        expect(retried.leaseId).toBe('asset-stage-known-operation');
        await expect(retriedTransfer.reopenDurableStagedAsset(retried.leaseId, retried.hash)).resolves.toMatchObject({
            status: 'opened',
        });
        retriedTransfer.dispose();
    });

    it('quiesces an already-started staging write before rebinding its owner', async () => {
        const durableAssets = createDurableAssetRepository(TEST_OWNER);
        const stagingStarted = Promise.withResolvers<void>();
        const allowStagingToFinish = Promise.withResolvers<void>();
        const serializedAssets = {
            ...durableAssets,
            stageAsset: async (...input: Parameters<typeof durableAssets.stageAsset>) => {
                stagingStarted.resolve();
                await allowStagingToFinish.promise;
                return durableAssets.stageAsset(...input);
            },
            prepareOwnerRebind: vi.fn(durableAssets.prepareOwnerRebind),
            commitOwnerRebind: vi.fn(durableAssets.commitOwnerRebind),
        };
        const serialTransfer = new AssetTransfer(
            peer,
            { onAssetAvailable, onProgress, onTransferFailed },
            TEST_OWNER,
            serializedAssets
        );

        const staging = serialTransfer.stageDurableAsset(
            new Blob(['owner-bound-write']),
            'owner-bound.wav',
            'asset-stage-owner-bound'
        );
        await stagingStarted.promise;
        const preparing = serialTransfer.prepareDurableOwnerRebind('project:rebound');
        await Promise.resolve();

        expect(serializedAssets.prepareOwnerRebind).not.toHaveBeenCalled();
        allowStagingToFinish.resolve();
        const staged = await staging;
        await expect(preparing).resolves.toMatchObject({ status: 'prepared', ownerId: 'project:rebound' });
        await expect(serialTransfer.commitDurableOwnerRebind('project:rebound')).resolves.toMatchObject({
            status: 'rebound',
            ownerId: 'project:rebound',
        });

        const recreated = new AssetTransfer(
            peer,
            { onAssetAvailable, onProgress, onTransferFailed },
            'project:rebound'
        );
        await expect(recreated.reopenDurableStagedAsset(staged.leaseId, staged.hash)).resolves.toMatchObject({
            status: 'opened',
        });
        recreated.dispose();
        serialTransfer.dispose();
    });

    it('releases only the exact project owner and reclaims bytes after the final owner leaves', async () => {
        const otherOwner = new AssetTransfer(peer, { onAssetAvailable, onProgress, onTransferFailed }, 'project:other');
        const blob = new Blob(['multi-project-original']);
        const first = await transfer.stageDurableAsset(blob, 'owner-a.wav', 'lease-owner-a');
        await transfer.promoteDurableStagedAsset(first.leaseId, first.hash);
        const second = await otherOwner.stageDurableAsset(blob, 'owner-b.wav', 'lease-owner-b');
        await otherOwner.promoteDurableStagedAsset(second.leaseId, second.hash);
        const hash = first.hash;
        expect(second.hash).toBe(hash);

        await expect(transfer.releaseDurableAsset(hash)).resolves.toEqual({
            status: 'released',
            hash,
            assetRemoved: false,
        });
        expect(transfer.hasAsset(hash)).toBe(false);
        await expect(otherOwner.reopenDurableAsset(hash)).resolves.toMatchObject({ status: 'opened' });

        await expect(otherOwner.releaseDurableAsset(hash)).resolves.toEqual({
            status: 'released',
            hash,
            assetRemoved: true,
        });
        await expect(otherOwner.reopenDurableAsset(hash)).resolves.toEqual({
            status: 'failed',
            reason: 'missing-asset',
        });
        otherOwner.dispose();
    });

    it('reopens an exact staged blob after its renderer owner is recreated', async () => {
        const staged = await transfer.stageDurableAsset(
            new Blob(['restart-safe-original'], { type: 'audio/wav' }),
            'restart-safe.wav',
            'asset-stage-restart-safe'
        );
        transfer.dispose();
        vi.resetModules();
        const { AssetTransfer: FreshAssetTransfer } = await import('../assetTransfer');
        const freshTransfer = new FreshAssetTransfer(
            peer,
            { onAssetAvailable, onProgress, onTransferFailed },
            TEST_OWNER
        );

        const reopened = await freshTransfer.reopenDurableStagedAsset(staged.leaseId, staged.hash);
        if (reopened.status === 'failed') {
            throw new Error(`reopen failed: ${reopened.reason}`);
        }

        expect(reopened).toMatchObject({ status: 'opened', name: 'restart-safe.wav' });
        expect(await reopened.blob?.text()).toBe('restart-safe-original');
        freshTransfer.dispose();
    });
});
