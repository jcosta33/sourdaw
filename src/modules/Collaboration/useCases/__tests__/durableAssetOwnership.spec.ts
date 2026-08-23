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

describe('durable asset ownership lifecycle', () => {
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
        transfer.dispose();
        vi.useRealTimers();
    });

    it('does not delete a committed duplicate when an earlier staging owner is cancelled', async () => {
        const first = await transfer.stageDurableAsset(
            new Blob(['same-content']),
            'first.wav',
            'asset-stage-same-first'
        );
        const second = await transfer.stageDurableAsset(
            new Blob(['same-content']),
            'second.wav',
            'asset-stage-same-second'
        );
        expect(second.hash).toBe(first.hash);

        await transfer.promoteDurableStagedAsset(second.leaseId, second.hash);
        await transfer.releaseDurableStagedAsset(first.leaseId, first.hash);

        expect(transfer.hasAsset(second.hash)).toBe(true);
    });

    it('fails closed for unknown, mismatched, and missing durable lease bindings', async () => {
        const staged = await transfer.stageDurableAsset(new Blob(['bound-original']), 'bound.wav', 'asset-stage-bound');

        await expect(transfer.reopenDurableStagedAsset(staged.leaseId, 'sha256:not-the-staged-hash')).resolves.toEqual({
            status: 'failed',
            reason: 'lease-hash-mismatch',
        });
        await expect(transfer.promoteDurableStagedAsset('asset-stage-unknown', staged.hash)).resolves.toEqual({
            status: 'failed',
            reason: 'unknown-lease',
        });
        await expect(transfer.releaseDurableStagedAsset('asset-stage-unknown', staged.hash)).resolves.toEqual({
            status: 'failed',
            reason: 'unknown-lease',
        });

        durableAssetIndexedDb.deleteAsset(staged.hash);
        await expect(transfer.promoteDurableStagedAsset(staged.leaseId, staged.hash)).resolves.toEqual({
            status: 'failed',
            reason: 'missing-asset',
        });

        const corrupted = await transfer.stageDurableAsset(
            new Blob(['corrupt-binding']),
            'corrupt.wav',
            'asset-stage-corrupt-binding'
        );
        durableAssetIndexedDb.overwriteLeaseHash(corrupted.leaseId, 'sha256:different-record');
        await expect(transfer.reopenDurableStagedAsset(corrupted.leaseId, corrupted.hash)).resolves.toEqual({
            status: 'failed',
            reason: 'lease-hash-mismatch',
        });

        const unbound = await transfer.stageDurableAsset(
            new Blob(['missing-backlink']),
            'unbound.wav',
            'asset-stage-unbound'
        );
        durableAssetIndexedDb.unlinkLeaseFromAsset(unbound.leaseId, unbound.hash);
        await expect(transfer.releaseDurableStagedAsset(unbound.leaseId, unbound.hash)).resolves.toEqual({
            status: 'failed',
            reason: 'corrupt-record',
        });

        const tampered = await transfer.stageDurableAsset(
            new Blob(['verified-bytes']),
            'tampered.wav',
            'asset-stage-tampered'
        );
        durableAssetIndexedDb.overwriteAssetBlob(tampered.hash, new Blob(['different-bytes']));
        await expect(transfer.reopenDurableStagedAsset(tampered.leaseId, tampered.hash)).resolves.toEqual({
            status: 'failed',
            reason: 'stored-hash-mismatch',
        });
    });

    it('keeps promoted original bytes after session teardown and owner recreation', async () => {
        const staged = await transfer.stageDurableAsset(
            new Blob(['project-owned']),
            'project.wav',
            'asset-stage-project-owned'
        );

        await expect(transfer.promoteDurableStagedAsset(staged.leaseId, staged.hash)).resolves.toMatchObject({
            status: 'promoted',
            hash: staged.hash,
        });
        transfer.dispose();
        vi.resetModules();
        const { AssetTransfer: FreshAssetTransfer } = await import('../assetTransfer');
        const freshTransfer = new FreshAssetTransfer(
            peer,
            { onAssetAvailable, onProgress, onTransferFailed },
            TEST_OWNER
        );

        const reopened = await freshTransfer.reopenDurableAsset(staged.hash);
        expect(reopened).toMatchObject({ status: 'opened', hash: staged.hash, name: 'project.wav' });
        expect(reopened.status === 'opened' ? await reopened.blob.text() : null).toBe('project-owned');
        freshTransfer.dispose();
    });

    it('serves a project-owned original after recreation without manual cache priming', async () => {
        const blob = new Blob(['restart-serve-original'], { type: 'audio/wav' });
        const staged = await transfer.stageDurableAsset(blob, 'restart-serve.wav', 'lease-restart-serve');
        await transfer.promoteDurableStagedAsset(staged.leaseId, staged.hash);
        const hash = staged.hash;
        transfer.dispose();
        const recreated = new AssetTransfer(peer, { onAssetAvailable, onProgress, onTransferFailed }, TEST_OWNER);

        await recreated.handleMessage('requester', {
            type: 'crdt-sync',
            docId: DOC_ID_ASSET,
            data: JSON.stringify({ type: 'asset.request', hash, missingChunks: [] }),
        });

        expect(peer.sendCrdtSync).toHaveBeenCalledWith(
            expect.objectContaining({
                peerId: 'requester',
                message: expect.objectContaining({ data: expect.stringContaining('asset.manifest') }),
            })
        );
        recreated.dispose();
    });

    it('rebinds a join-created owner to the synchronized project identity before recreation', async () => {
        const provisionalOwner = 'collaboration-join:attempt-1';
        const hostOwner = 'project:host-authoritative';
        const joining = new AssetTransfer(peer, { onAssetAvailable, onProgress, onTransferFailed }, provisionalOwner);
        const staged = await joining.stageDurableAsset(
            new Blob(['host-bound-original'], { type: 'audio/wav' }),
            'host-bound.wav',
            'asset-stage-host-bound'
        );

        await joining.prepareDurableOwnerRebind(hostOwner);
        await joining.commitDurableOwnerRebind(hostOwner);
        joining.dispose();
        const recreated = new AssetTransfer(peer, { onAssetAvailable, onProgress, onTransferFailed }, hostOwner);

        await expect(recreated.reopenDurableStagedAsset(staged.leaseId, staged.hash)).resolves.toMatchObject({
            status: 'opened',
            hash: staged.hash,
        });
        recreated.dispose();
    });

    it('carries pre-join project staging through the synchronized host-owner handoff', async () => {
        const settledOwner = 'project:pre-join-settled';
        const provisionalOwner = 'collaboration-join:with-prepared-assets';
        const hostOwner = 'project:host-after-join';
        const settled = new AssetTransfer(peer, { onAssetAvailable, onProgress, onTransferFailed }, settledOwner);
        const promotedLease = await settled.stageDurableAsset(
            new Blob(['pre-join-original'], { type: 'audio/wav' }),
            'pre-join.wav',
            'asset-stage-pre-join-promote'
        );
        const releasedLease = await settled.stageDurableAsset(
            new Blob(['pre-join-original'], { type: 'audio/wav' }),
            'pre-join.wav',
            'asset-stage-pre-join-release'
        );
        settled.dispose();

        const joining = new AssetTransfer(
            peer,
            { onAssetAvailable, onProgress, onTransferFailed },
            provisionalOwner,
            undefined,
            { durableStagingReady: false, handoffSourceOwnerIds: [settledOwner] }
        );
        // Mirrors AutomergeSync's fenced host-root lifecycle: journal every
        // captured source at acceptance, persist the root, then commit handoff.
        await expect(joining.prepareDurableOwnerRebind(hostOwner)).resolves.toMatchObject({ status: 'prepared' });
        await expect(joining.commitDurableOwnerRebind(hostOwner)).resolves.toMatchObject({ status: 'rebound' });
        joining.dispose();

        const recreated = new AssetTransfer(peer, { onAssetAvailable, onProgress, onTransferFailed }, hostOwner);
        await expect(
            recreated.reopenDurableStagedAsset(promotedLease.leaseId, promotedLease.hash)
        ).resolves.toMatchObject({ status: 'opened', hash: promotedLease.hash });
        await expect(
            recreated.promoteDurableStagedAsset(promotedLease.leaseId, promotedLease.hash)
        ).resolves.toMatchObject({ status: 'promoted', hash: promotedLease.hash });
        await expect(
            recreated.releaseDurableStagedAsset(releasedLease.leaseId, releasedLease.hash)
        ).resolves.toMatchObject({ status: 'released', hash: releasedLease.hash });
        await expect(recreated.reopenDurableAsset(promotedLease.hash)).resolves.toMatchObject({
            status: 'opened',
            hash: promotedLease.hash,
        });
        recreated.dispose();
    });

    it('fences already-started pre-join staging ahead of its host-owner handoff', async () => {
        const settledOwner = 'project:late-pre-join-stage';
        const provisionalOwner = 'collaboration-join:late-prepared-assets';
        const hostOwner = 'project:late-stage-host';
        let releaseHashing!: () => void;
        let signalHashingStarted!: () => void;
        const hashingStarted = new Promise<void>((resolve) => {
            signalHashingStarted = resolve;
        });
        const hashingMayFinish = new Promise<void>((resolve) => {
            releaseHashing = resolve;
        });
        class DeferredBlob extends Blob {
            override async arrayBuffer(): Promise<ArrayBuffer> {
                signalHashingStarted();
                await hashingMayFinish;
                return new TextEncoder().encode('late-pre-join-original').buffer;
            }
        }
        const lateBlob = new DeferredBlob(['late-pre-join-original'], { type: 'audio/wav' });
        const settled = new AssetTransfer(peer, { onAssetAvailable, onProgress, onTransferFailed }, settledOwner);
        const promotedPromise = settled.stageDurableAsset(
            lateBlob,
            'late-promote.wav',
            'asset-stage-late-pre-join-promote'
        );
        await hashingStarted;
        const releasedPromise = settled.stageDurableAsset(
            new Blob(['late-pre-join-release'], { type: 'audio/wav' }),
            'late-release.wav',
            'asset-stage-late-pre-join-release'
        );

        const joining = new AssetTransfer(
            peer,
            { onAssetAvailable, onProgress, onTransferFailed },
            provisionalOwner,
            undefined,
            { durableStagingReady: false, handoffSourceOwnerIds: [settledOwner] }
        );
        const handoff = (async () => {
            await joining.prepareDurableOwnerRebind(hostOwner);
            await joining.commitDurableOwnerRebind(hostOwner);
        })();
        const handoffBeforeStage = await Promise.race([
            handoff.then(() => true),
            new Promise<false>((resolve) => setTimeout(() => resolve(false), 10)),
        ]);
        releaseHashing();
        const promotedLease = await promotedPromise.catch((error: unknown) => {
            throw new Error('Late promoted staging failed', { cause: error });
        });
        const releasedLease = await releasedPromise.catch((error: unknown) => {
            throw new Error('Late released staging failed', { cause: error });
        });
        await handoff.catch((error: unknown) => {
            throw new Error('Late staging handoff failed', { cause: error });
        });
        settled.dispose();
        joining.dispose();

        expect(handoffBeforeStage).toBe(false);
        const recreated = new AssetTransfer(peer, { onAssetAvailable, onProgress, onTransferFailed }, hostOwner);
        await expect(
            recreated.reopenDurableStagedAsset(promotedLease.leaseId, promotedLease.hash)
        ).resolves.toMatchObject({ status: 'opened', hash: promotedLease.hash });
        await expect(
            recreated.promoteDurableStagedAsset(promotedLease.leaseId, promotedLease.hash)
        ).resolves.toMatchObject({ status: 'promoted', hash: promotedLease.hash });
        await expect(
            recreated.releaseDurableStagedAsset(releasedLease.leaseId, releasedLease.hash)
        ).resolves.toMatchObject({ status: 'released', hash: releasedLease.hash });
        const staleOwner = new AssetTransfer(peer, { onAssetAvailable, onProgress, onTransferFailed }, settledOwner);
        await expect(staleOwner.reopenDurableAsset(promotedLease.hash)).resolves.toEqual({
            status: 'failed',
            reason: 'asset-not-owned',
        });
        staleOwner.dispose();
        recreated.dispose();
    });

    it('resumes a prepared owner handoff after restart before reopening its exact lease', async () => {
        const provisionalOwner = 'collaboration-join:crash-before-handoff-commit';
        const projectOwner = 'project:restart-authoritative';
        const joining = new AssetTransfer(peer, { onAssetAvailable, onProgress, onTransferFailed }, provisionalOwner);
        const staged = await joining.stageDurableAsset(
            new Blob(['restart-handoff-original']),
            'restart-handoff.wav',
            'asset-stage-restart-handoff'
        );
        await expect(joining.prepareDurableOwnerRebind(projectOwner)).resolves.toMatchObject({
            status: 'prepared',
        });
        expect(durableAssetIndexedDb.countRecords('ownerHandoffs')).toBe(1);
        joining.dispose();

        const recreated = new AssetTransfer(peer, { onAssetAvailable, onProgress, onTransferFailed }, projectOwner);
        await expect(recreated.reopenDurableStagedAsset(staged.leaseId, staged.hash)).resolves.toMatchObject({
            status: 'opened',
            hash: staged.hash,
        });
        expect(durableAssetIndexedDb.countRecords('ownerHandoffs')).toBe(0);
        await expect(
            createDurableAssetRepository(provisionalOwner).reopenStagedAsset(staged.leaseId, staged.hash)
        ).resolves.toEqual({ status: 'failed', reason: 'lease-owner-mismatch' });
        recreated.dispose();
    });

    it('keeps a handoff executable across bounded transaction failures and restart', async () => {
        const provisionalOwner = 'collaboration-join:bounded-retry';
        const projectOwner = 'project:bounded-retry-authoritative';
        const joining = new AssetTransfer(peer, { onAssetAvailable, onProgress, onTransferFailed }, provisionalOwner);
        const staged = await joining.stageDurableAsset(
            new Blob(['bounded-retry-original']),
            'bounded-retry.wav',
            'asset-stage-bounded-retry'
        );
        await joining.prepareDurableOwnerRebind(projectOwner);
        durableAssetIndexedDb.failNextReadwriteTransactions(3);

        for (let attempt = 0; attempt < 3; attempt += 1) {
            await expect(joining.commitDurableOwnerRebind(projectOwner)).rejects.toThrow('aborted');
        }
        expect(durableAssetIndexedDb.countRecords('ownerHandoffs')).toBe(1);
        joining.dispose();

        const recreated = new AssetTransfer(peer, { onAssetAvailable, onProgress, onTransferFailed }, projectOwner);
        await expect(recreated.reopenDurableStagedAsset(staged.leaseId, staged.hash)).resolves.toMatchObject({
            status: 'opened',
            hash: staged.hash,
        });
        expect(durableAssetIndexedDb.countRecords('ownerHandoffs')).toBe(0);
        recreated.dispose();
    });

    it('retains the handoff journal when an indexed lease has no matching asset backlink', async () => {
        const provisionalOwner = 'collaboration-join:malformed-index';
        const projectOwner = 'project:malformed-index-authoritative';
        const joining = new AssetTransfer(peer, { onAssetAvailable, onProgress, onTransferFailed }, provisionalOwner);
        const staged = await joining.stageDurableAsset(
            new Blob(['malformed-index-original']),
            'malformed-index.wav',
            'asset-stage-malformed-index'
        );
        await joining.prepareDurableOwnerRebind(projectOwner);
        durableAssetIndexedDb.unlinkLeaseFromAsset(staged.leaseId, staged.hash);

        await expect(joining.commitDurableOwnerRebind(projectOwner)).resolves.toEqual({
            status: 'failed',
            reason: 'corrupt-record',
        });
        expect(durableAssetIndexedDb.countRecords('ownerHandoffs')).toBe(1);
        await expect(
            createDurableAssetRepository(projectOwner).reopenStagedAsset(staged.leaseId, staged.hash)
        ).resolves.toEqual({ status: 'failed', reason: 'lease-owner-mismatch' });
        joining.dispose();
    });

    it('releases exactly once and deletes only uncommitted unshared bytes', async () => {
        const first = await transfer.stageDurableAsset(
            new Blob(['shared-staging']),
            'first.wav',
            'asset-stage-shared-first'
        );
        const second = await transfer.stageDurableAsset(
            new Blob(['shared-staging']),
            'second.wav',
            'asset-stage-shared-second'
        );

        await expect(transfer.releaseDurableStagedAsset(first.leaseId, first.hash)).resolves.toMatchObject({
            status: 'released',
            assetRemoved: false,
        });
        await expect(transfer.reopenDurableStagedAsset(second.leaseId, second.hash)).resolves.toMatchObject({
            status: 'opened',
        });
        await expect(transfer.releaseDurableStagedAsset(second.leaseId, second.hash)).resolves.toMatchObject({
            status: 'released',
            assetRemoved: true,
        });
        await expect(transfer.releaseDurableStagedAsset(second.leaseId, second.hash)).resolves.toEqual({
            status: 'already-released',
            leaseId: second.leaseId,
            hash: second.hash,
            assetRemoved: true,
            ownerRetained: false,
        });
        await expect(transfer.reopenDurableStagedAsset(second.leaseId, second.hash)).resolves.toEqual({
            status: 'failed',
            reason: 'lease-terminal-conflict',
        });
    });

    it('promotes exactly once without letting release undo committed ownership', async () => {
        const staged = await transfer.stageDurableAsset(
            new Blob(['commit-once']),
            'committed.wav',
            'asset-stage-commit-once'
        );

        await expect(transfer.promoteDurableStagedAsset(staged.leaseId, staged.hash)).resolves.toMatchObject({
            status: 'promoted',
        });
        await expect(transfer.promoteDurableStagedAsset(staged.leaseId, staged.hash)).resolves.toMatchObject({
            status: 'already-promoted',
        });
        await expect(transfer.releaseDurableStagedAsset(staged.leaseId, staged.hash)).resolves.toEqual({
            status: 'failed',
            reason: 'lease-terminal-conflict',
        });
        await expect(transfer.reopenDurableAsset(staged.hash)).resolves.toMatchObject({ status: 'opened' });
    });

    it('recovers committed promotion after two failed attempts and transfer recreation', async () => {
        const staged = await transfer.stageDurableAsset(
            new Blob(['committed-recovery'], { type: 'audio/wav' }),
            'committed-recovery.wav',
            'asset-stage-committed-recovery'
        );
        await transfer.reopenDurableStagedAsset(staged.leaseId, staged.hash);
        await expect(
            transfer.prepareDurablePromotionRecovery('stem-promotion:committed-recovery', [
                { leaseId: staged.leaseId, expectedHash: staged.hash },
            ])
        ).resolves.toMatchObject({ status: 'prepared' });
        await expect(
            transfer.commitDurablePromotionRecovery('stem-promotion:committed-recovery')
        ).resolves.toMatchObject({ status: 'committed' });
        await expect(
            createDurableAssetRepository(TEST_OWNER).releaseStagedAsset(staged.leaseId, staged.hash)
        ).resolves.toEqual({ status: 'failed', reason: 'lease-terminal-conflict' });
        durableAssetIndexedDb.failNextReadwriteTransactions(3);

        await expect(transfer.promoteDurableStagedAsset(staged.leaseId, staged.hash)).rejects.toThrow('aborted');
        await expect(transfer.promoteDurableStagedAsset(staged.leaseId, staged.hash)).rejects.toThrow('aborted');
        await expect(transfer.completeDurablePromotionRecovery('stem-promotion:committed-recovery')).rejects.toThrow(
            'aborted'
        );
        expect(durableAssetIndexedDb.countRecords('promotionRecoveries')).toBe(1);
        transfer.dispose();

        const recreated = new AssetTransfer(peer, { onAssetAvailable, onProgress, onTransferFailed }, TEST_OWNER);
        await expect(recreated.reopenDurableAsset(staged.hash)).resolves.toMatchObject({
            status: 'opened',
            hash: staged.hash,
        });
        await expect(recreated.promoteDurableStagedAsset(staged.leaseId, staged.hash)).resolves.toMatchObject({
            status: 'already-promoted',
            hash: staged.hash,
        });
        await expect(
            recreated.cancelDurablePromotionRecovery('stem-promotion:committed-recovery')
        ).resolves.toMatchObject({ status: 'missing' });
        expect(durableAssetIndexedDb.countRecords('promotionRecoveries')).toBe(0);
        recreated.dispose();
    });

    it('does not let an ordinary durable operation promote a pre-commit recovery claim', async () => {
        const staged = await transfer.stageDurableAsset(
            new Blob(['pre-commit-promotion'], { type: 'audio/wav' }),
            'pre-commit-promotion.wav',
            'asset-stage-pre-commit-promotion'
        );
        await expect(
            transfer.prepareDurablePromotionRecovery('stem-promotion:pre-commit', [
                { leaseId: staged.leaseId, expectedHash: staged.hash },
            ])
        ).resolves.toMatchObject({ status: 'prepared' });

        await expect(transfer.reopenDurableAsset(staged.hash)).resolves.toEqual({
            status: 'failed',
            reason: 'asset-not-owned',
        });
        await expect(transfer.cancelDurablePromotionRecovery('stem-promotion:pre-commit')).resolves.toMatchObject({
            status: 'cancelled',
        });
        await expect(transfer.releaseDurableStagedAsset(staged.leaseId, staged.hash)).resolves.toMatchObject({
            status: 'released',
            assetRemoved: true,
        });
        expect(durableAssetIndexedDb.countRecords('assets')).toBe(0);
    });

    it('does not strand a staged lease when cancellation crashes after removing its promotion claim', async () => {
        const staged = await transfer.stageDurableAsset(
            new Blob(['cancel-transition-crash'], { type: 'audio/wav' }),
            'cancel-transition-crash.wav',
            'asset-stage-cancel-transition-crash'
        );
        await transfer.prepareDurablePromotionRecovery('stem-promotion:cancel-transition-crash', [
            { leaseId: staged.leaseId, expectedHash: staged.hash },
        ]);

        await transfer.transitionDurablePromotionRecoveryToCleanup('stem-promotion:cancel-transition-crash', [
            { leaseId: staged.leaseId, expectedHash: staged.hash },
        ]);
        transfer.dispose();

        const recreated = new AssetTransfer(peer, { onAssetAvailable, onProgress, onTransferFailed }, TEST_OWNER);
        await expect(recreated.reopenDurableStagedAsset(staged.leaseId, staged.hash)).resolves.toEqual({
            status: 'failed',
            reason: 'lease-terminal-conflict',
        });
        expect(durableAssetIndexedDb.countRecords('promotionRecoveries')).toBe(0);
        expect(durableAssetIndexedDb.countRecords('assets')).toBe(0);
        recreated.dispose();
    });

    it('recovers failed staged cleanup after transfer recreation without replaying its caller', async () => {
        const staged = await transfer.stageDurableAsset(
            new Blob(['discard-recovery'], { type: 'audio/wav' }),
            'discard-recovery.wav',
            'asset-stage-discard-recovery'
        );
        await expect(
            transfer.prepareDurableCleanupRecovery('stem-cleanup:discard-recovery', [
                { leaseId: staged.leaseId, expectedHash: staged.hash },
            ])
        ).resolves.toMatchObject({ status: 'prepared' });
        durableAssetIndexedDb.failNextReadwriteTransactions(1);
        await expect(transfer.completeDurableCleanupRecovery('stem-cleanup:discard-recovery')).rejects.toThrow(
            'aborted'
        );
        await expect(
            transfer.prepareDurableCleanupRecovery('stem-cleanup:discard-recovery', [
                { leaseId: staged.leaseId, expectedHash: staged.hash },
            ])
        ).resolves.toMatchObject({ status: 'prepared' });
        expect(durableAssetIndexedDb.countRecords('promotionRecoveries')).toBe(1);
        transfer.dispose();

        const recreated = new AssetTransfer(peer, { onAssetAvailable, onProgress, onTransferFailed }, TEST_OWNER);
        await expect(recreated.reopenDurableAsset(staged.hash)).resolves.toEqual({
            status: 'failed',
            reason: 'missing-asset',
        });
        expect(durableAssetIndexedDb.countRecords('promotionRecoveries')).toBe(0);
        expect(durableAssetIndexedDb.countRecords('assets')).toBe(0);
        recreated.dispose();
    });

    it('keeps an exact staged lease restart-retryable when cleanup ownership preparation aborts', async () => {
        const staged = await transfer.stageDurableAsset(
            new Blob(['cleanup-prepare-restart'], { type: 'audio/wav' }),
            'cleanup-prepare-restart.wav',
            'asset-stage-cleanup-prepare-restart'
        );
        const binding = { leaseId: staged.leaseId, expectedHash: staged.hash };
        durableAssetIndexedDb.failNextReadwriteTransactions(1);

        await expect(transfer.prepareDurableCleanupRecovery('stem-cleanup:prepare-restart', [binding])).rejects.toThrow(
            'aborted'
        );
        transfer.dispose();

        const recreated = new AssetTransfer(peer, { onAssetAvailable, onProgress, onTransferFailed }, TEST_OWNER);
        await expect(recreated.reopenDurableStagedAsset(staged.leaseId, staged.hash)).resolves.toMatchObject({
            status: 'opened',
            leaseState: 'staged',
        });
        await expect(
            recreated.prepareDurableCleanupRecovery('stem-cleanup:prepare-restart', [binding])
        ).resolves.toMatchObject({ status: 'prepared' });
        await expect(recreated.completeDurableCleanupRecovery('stem-cleanup:prepare-restart')).resolves.toMatchObject({
            status: 'completed',
            releasedHashes: [staged.hash],
        });
        expect(durableAssetIndexedDb.countRecords('assets')).toBe(0);
        recreated.dispose();
    });

    it('settles an incoming source handoff before preparing the source for a chained handoff', async () => {
        const ownerA = 'project:chain-a';
        const ownerB = 'project:chain-b';
        const ownerC = 'project:chain-c';
        const provisional = 'collaboration-join:chain-provisional';
        const sourceA = new AssetTransfer(peer, { onAssetAvailable, onProgress, onTransferFailed }, ownerA);
        const staged = await sourceA.stageDurableAsset(
            new Blob(['chained-owner-handoff'], { type: 'audio/wav' }),
            'chained-owner-handoff.wav',
            'asset-stage-chained-owner-handoff'
        );
        await sourceA.promoteDurableStagedAsset(staged.leaseId, staged.hash);
        await createDurableAssetRepository(ownerA).prepareOwnerRebind(ownerB);
        sourceA.dispose();

        const joining = new AssetTransfer(
            peer,
            { onAssetAvailable, onProgress, onTransferFailed },
            provisional,
            createDurableAssetRepository(provisional),
            { handoffSourceOwnerIds: [ownerB] }
        );
        await expect(joining.prepareDurableOwnerRebind(ownerC)).resolves.toMatchObject({ status: 'prepared' });
        await expect(joining.commitDurableOwnerRebind(ownerC)).resolves.toMatchObject({
            status: 'rebound',
            ownerId: ownerC,
            reboundHashes: expect.arrayContaining([staged.hash]),
        });
        joining.dispose();

        await expect(createDurableAssetRepository(ownerC).reopenDurableAsset(staged.hash)).resolves.toMatchObject({
            status: 'opened',
        });
        await expect(createDurableAssetRepository(ownerA).reopenDurableAsset(staged.hash)).resolves.toEqual({
            status: 'failed',
            reason: 'asset-not-owned',
        });
    });

    it('routes cleanup to the lease owner when the active project owner changed without a handoff', async () => {
        const ownerA = 'project:cleanup-lineage-a';
        const ownerB = 'project:cleanup-lineage-b';
        const source = new AssetTransfer(peer, { onAssetAvailable, onProgress, onTransferFailed }, ownerA);
        const staged = await source.stageDurableAsset(
            new Blob(['cleanup-owner-lineage'], { type: 'audio/wav' }),
            'cleanup-owner-lineage.wav',
            'asset-stage-cleanup-owner-lineage'
        );
        source.dispose();

        const current = new AssetTransfer(peer, { onAssetAvailable, onProgress, onTransferFailed }, ownerB);
        const binding = { leaseId: staged.leaseId, expectedHash: staged.hash };
        await expect(current.prepareDurableCleanupRecovery('stem-cleanup:owner-lineage', [binding])).resolves.toEqual({
            status: 'prepared',
            recoveryId: 'stem-cleanup:owner-lineage',
            ownerId: ownerA,
        });
        await expect(current.completeDurableCleanupRecovery('stem-cleanup:owner-lineage')).resolves.toMatchObject({
            status: 'completed',
            releasedHashes: [staged.hash],
        });
        expect(durableAssetIndexedDb.countRecords('assets')).toBe(0);
        current.dispose();
    });

    it('rejects a delayed independent-realm stage after its owner handoff commits', async () => {
        const ownerA = 'project:realm-fence-a';
        const ownerB = 'project:realm-fence-b';
        const source = createDurableAssetRepository(ownerA);
        const stageStarted = Promise.withResolvers<void>();
        const allowStageTransaction = Promise.withResolvers<void>();
        const lateStage = (async () => {
            stageStarted.resolve();
            await allowStageTransaction.promise;
            return source.stageAsset(
                'asset-stage-independent-realm',
                new Blob(['independent-realm-stage']),
                'independent-realm-stage.wav'
            );
        })();
        await stageStarted.promise;
        await source.prepareOwnerRebind(ownerB);
        await source.commitOwnerRebind(ownerB);

        allowStageTransaction.resolve();
        await expect(lateStage).rejects.toThrow('owner authority moved');
        expect(durableAssetIndexedDb.countRecords('assets')).toBe(0);
        expect(durableAssetIndexedDb.countRecords('leases')).toBe(0);
    });

    it('fences cleanup from ordinary release and atomically transfers its exact claim to promotion', async () => {
        const staged = await transfer.stageDurableAsset(
            new Blob(['cleanup-to-promotion'], { type: 'audio/wav' }),
            'cleanup-to-promotion.wav',
            'asset-stage-cleanup-to-promotion'
        );
        const binding = { leaseId: staged.leaseId, expectedHash: staged.hash };
        await expect(
            transfer.prepareDurableCleanupRecovery('stem-cleanup:cleanup-to-promotion', [binding])
        ).resolves.toMatchObject({ status: 'prepared' });
        await expect(
            createDurableAssetRepository(TEST_OWNER).releaseStagedAsset(staged.leaseId, staged.hash)
        ).resolves.toEqual({ status: 'failed', reason: 'lease-terminal-conflict' });

        await expect(
            transfer.prepareDurablePromotionRecovery('stem-promotion:cleanup-to-promotion', [binding])
        ).resolves.toMatchObject({ status: 'prepared' });
        await expect(
            transfer.commitDurablePromotionRecovery('stem-promotion:cleanup-to-promotion')
        ).resolves.toMatchObject({ status: 'committed' });
        await expect(
            transfer.completeDurableCleanupRecovery('stem-cleanup:cleanup-to-promotion')
        ).resolves.toMatchObject({ status: 'missing' });
        await expect(
            transfer.completeDurablePromotionRecovery('stem-promotion:cleanup-to-promotion')
        ).resolves.toMatchObject({ status: 'completed', promotedHashes: [staged.hash] });
        await expect(transfer.reopenDurableAsset(staged.hash)).resolves.toMatchObject({ status: 'opened' });
    });

    it('makes concurrent promotion from two repository owners transactionally idempotent', async () => {
        const first = createDurableAssetRepository(TEST_OWNER);
        const second = createDurableAssetRepository(TEST_OWNER);
        const staged = await first.stageAsset(
            'asset-stage-concurrent-promotion',
            new Blob(['concurrent-promotion']),
            'concurrent.wav'
        );

        const results = await Promise.all([
            first.promoteStagedAsset(staged.leaseId, staged.hash),
            second.promoteStagedAsset(staged.leaseId, staged.hash),
        ]);

        expect(results.map((result) => result.status).sort()).toEqual(['already-promoted', 'promoted']);
        await expect(first.reopenDurableAsset(staged.hash)).resolves.toMatchObject({ status: 'opened' });
        await expect(second.reopenStagedAsset(staged.leaseId, staged.hash)).resolves.toMatchObject({
            status: 'opened',
            leaseState: 'promoted',
        });
    });

    it('releases and rebinds through targeted ownership indexes regardless of unrelated rows', async () => {
        for (let index = 0; index < 24; index += 1) {
            await createDurableAssetRepository(`project:unrelated-${String(index)}`).stageAsset(
                `lease:unrelated-${String(index)}`,
                new Blob([`unrelated-${String(index)}`]),
                `unrelated-${String(index)}.wav`
            );
        }
        const repository = createDurableAssetRepository('project:bounded');
        const staged = await repository.stageAsset('lease:bounded', new Blob(['bounded']), 'bounded.wav');

        await expect(repository.releaseStagedAsset(staged.leaseId, staged.hash)).resolves.toMatchObject({
            status: 'released',
        });
        await expect(repository.prepareOwnerRebind('project:bounded-next')).resolves.toMatchObject({
            status: 'prepared',
        });
        await expect(repository.commitOwnerRebind('project:bounded-next')).resolves.toMatchObject({
            status: 'rebound',
        });

        expect(durableAssetIndexedDb.getFullScanCount()).toBe(0);
    });

    it('consumes a stale self-handoff instead of leaving a permanent journal conflict', async () => {
        const ownerId = 'project:self-handoff';
        const repository = createDurableAssetRepository(ownerId);
        await repository.reopenDurableAsset('sha256:initialize-schema');
        durableAssetIndexedDb.seedOwnerHandoff({ previousOwnerId: ownerId, nextOwnerId: ownerId });

        await expect(repository.prepareOwnerRebind(ownerId)).resolves.toMatchObject({ status: 'prepared' });

        expect(durableAssetIndexedDb.countRecords('ownerHandoffs')).toBe(0);
    });

    it('retires an outgoing prepare record when restart confirms the previous owner remained canonical', async () => {
        const ownerId = 'project:restart-canonical-owner';
        const repository = createDurableAssetRepository(ownerId);
        await repository.reopenDurableAsset('sha256:initialize-schema');
        durableAssetIndexedDb.seedOwnerHandoff({
            previousOwnerId: ownerId,
            nextOwnerId: 'project:unpublished-candidate',
        });

        await expect(repository.resumeOwnerRebinds()).resolves.toMatchObject({ status: 'resumed', ownerId });
        await expect(repository.prepareOwnerRebind('project:later-authoritative')).resolves.toMatchObject({
            status: 'prepared',
        });

        expect(durableAssetIndexedDb.countRecords('ownerHandoffs')).toBe(1);
    });

    it('reclaims an exact terminal project owner while retaining shared hashes and compacting its leases', async () => {
        const shared = new Blob(['shared-original']);
        const first = createDurableAssetRepository('project:terminal-first');
        const second = createDurableAssetRepository('project:terminal-second');
        const firstLease = await first.stageAsset('lease:terminal-first', shared, 'shared.wav');
        await first.promoteStagedAsset(firstLease.leaseId, firstLease.hash);
        const secondLease = await second.stageAsset('lease:terminal-second', shared, 'shared.wav');
        await second.promoteStagedAsset(secondLease.leaseId, secondLease.hash);

        await expect(first.releaseOwner()).resolves.toMatchObject({
            status: 'released',
            removedAssets: 0,
            compactedLeases: 1,
        });
        await expect(second.reopenDurableAsset(secondLease.hash)).resolves.toMatchObject({ status: 'opened' });
        expect(durableAssetIndexedDb.countRecords('leases')).toBe(1);

        await expect(second.releaseOwner()).resolves.toMatchObject({
            status: 'released',
            removedAssets: 1,
            compactedLeases: 1,
        });
        expect(durableAssetIndexedDb.countRecords('assets')).toBe(0);
        expect(durableAssetIndexedDb.countRecords('leases')).toBe(0);
    });

    it('expires terminal lease receipts without deleting their project-owned original', async () => {
        const repository = createDurableAssetRepository('project:receipt-retention');
        const old = await repository.stageAsset('lease:old-receipt', new Blob(['old']), 'old.wav');
        await repository.promoteStagedAsset(old.leaseId, old.hash);
        durableAssetIndexedDb.overwriteLeaseTerminalAt(old.leaseId, Date.now() - 31 * 24 * 60 * 60 * 1000);

        const current = await repository.stageAsset('lease:current-receipt', new Blob(['current']), 'current.wav');
        await repository.promoteStagedAsset(current.leaseId, current.hash);

        await expect(repository.reopenStagedAsset(old.leaseId, old.hash)).resolves.toEqual({
            status: 'failed',
            reason: 'unknown-lease',
        });
        await expect(repository.reopenDurableAsset(old.hash)).resolves.toMatchObject({ status: 'opened' });
    });

    it('caps fresh terminal receipts without deleting promoted blobs or recent retry evidence', async () => {
        const repository = createDurableAssetRepository('project:receipt-count-cap');
        const oldest = await repository.stageAsset(
            'lease:receipt-oldest',
            new Blob(['oldest-owned-original']),
            'oldest.wav'
        );
        await repository.promoteStagedAsset(oldest.leaseId, oldest.hash);
        const now = Date.now();
        durableAssetIndexedDb.overwriteLeaseTerminalAt(oldest.leaseId, now - 1_000);
        for (let index = 0; index < 4_095; index += 1) {
            durableAssetIndexedDb.seedPromotedLease({
                leaseId: `lease:receipt-recent-${String(index)}`,
                ownerId: 'project:receipt-count-cap',
                hash: oldest.hash,
                terminalAt: now,
            });
        }
        const trigger = await repository.stageAsset(
            'lease:receipt-trigger',
            new Blob(['trigger-owned-original']),
            'trigger.wav'
        );

        await repository.promoteStagedAsset(trigger.leaseId, trigger.hash);

        await expect(repository.reopenStagedAsset(oldest.leaseId, oldest.hash)).resolves.toEqual({
            status: 'failed',
            reason: 'unknown-lease',
        });
        await expect(repository.promoteStagedAsset('lease:receipt-recent-4094', oldest.hash)).resolves.toMatchObject({
            status: 'already-promoted',
        });
        await expect(repository.reopenDurableAsset(oldest.hash)).resolves.toMatchObject({ status: 'opened' });
        await expect(repository.reopenDurableAsset(trigger.hash)).resolves.toMatchObject({ status: 'opened' });
    });
});
