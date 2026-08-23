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
        const first = await transfer.stageLocalAsset(new Blob(['same-content']), 'first.wav', 'asset-stage-same-first');
        const second = await transfer.stageLocalAsset(
            new Blob(['same-content']),
            'second.wav',
            'asset-stage-same-second'
        );
        expect(second.hash).toBe(first.hash);

        await transfer.promoteStagedAsset(second.leaseId, second.hash);
        await transfer.releaseStagedAsset(first.leaseId, first.hash);

        expect(transfer.hasAsset(second.hash)).toBe(true);
    });

    it('fails closed for unknown, mismatched, and missing durable lease bindings', async () => {
        const staged = await transfer.stageLocalAsset(new Blob(['bound-original']), 'bound.wav', 'asset-stage-bound');

        await expect(transfer.reopenStagedAsset(staged.leaseId, 'sha256:not-the-staged-hash')).resolves.toEqual({
            status: 'failed',
            reason: 'lease-hash-mismatch',
        });
        await expect(transfer.promoteStagedAsset('asset-stage-unknown', staged.hash)).resolves.toEqual({
            status: 'failed',
            reason: 'unknown-lease',
        });
        await expect(transfer.releaseStagedAsset('asset-stage-unknown', staged.hash)).resolves.toEqual({
            status: 'failed',
            reason: 'unknown-lease',
        });

        durableAssetIndexedDb.deleteAsset(staged.hash);
        await expect(transfer.promoteStagedAsset(staged.leaseId, staged.hash)).resolves.toEqual({
            status: 'failed',
            reason: 'missing-asset',
        });

        const corrupted = await transfer.stageLocalAsset(
            new Blob(['corrupt-binding']),
            'corrupt.wav',
            'asset-stage-corrupt-binding'
        );
        durableAssetIndexedDb.overwriteLeaseHash(corrupted.leaseId, 'sha256:different-record');
        await expect(transfer.reopenStagedAsset(corrupted.leaseId, corrupted.hash)).resolves.toEqual({
            status: 'failed',
            reason: 'lease-hash-mismatch',
        });

        const unbound = await transfer.stageLocalAsset(
            new Blob(['missing-backlink']),
            'unbound.wav',
            'asset-stage-unbound'
        );
        durableAssetIndexedDb.unlinkLeaseFromAsset(unbound.leaseId, unbound.hash);
        await expect(transfer.releaseStagedAsset(unbound.leaseId, unbound.hash)).resolves.toEqual({
            status: 'failed',
            reason: 'corrupt-record',
        });

        const tampered = await transfer.stageLocalAsset(
            new Blob(['verified-bytes']),
            'tampered.wav',
            'asset-stage-tampered'
        );
        durableAssetIndexedDb.overwriteAssetBlob(tampered.hash, new Blob(['different-bytes']));
        await expect(transfer.reopenStagedAsset(tampered.leaseId, tampered.hash)).resolves.toEqual({
            status: 'failed',
            reason: 'stored-hash-mismatch',
        });
    });

    it('keeps promoted original bytes after session teardown and owner recreation', async () => {
        const staged = await transfer.stageLocalAsset(
            new Blob(['project-owned']),
            'project.wav',
            'asset-stage-project-owned'
        );

        await expect(transfer.promoteStagedAsset(staged.leaseId, staged.hash)).resolves.toMatchObject({
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

        const reopened = await freshTransfer.reopenLocalAsset(staged.hash);
        expect(reopened).toMatchObject({ status: 'opened', hash: staged.hash, name: 'project.wav' });
        expect(reopened.status === 'opened' ? await reopened.blob.text() : null).toBe('project-owned');
        freshTransfer.dispose();
    });

    it('serves a project-owned original after recreation without manual cache priming', async () => {
        const blob = new Blob(['restart-serve-original'], { type: 'audio/wav' });
        const staged = await transfer.stageLocalAsset(blob, 'restart-serve.wav', 'lease-restart-serve');
        await transfer.promoteStagedAsset(staged.leaseId, staged.hash);
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
        const staged = await joining.stageLocalAsset(
            new Blob(['host-bound-original'], { type: 'audio/wav' }),
            'host-bound.wav',
            'asset-stage-host-bound'
        );

        await joining.rebindOwner(hostOwner);
        joining.dispose();
        const recreated = new AssetTransfer(peer, { onAssetAvailable, onProgress, onTransferFailed }, hostOwner);

        await expect(recreated.reopenStagedAsset(staged.leaseId, staged.hash)).resolves.toMatchObject({
            status: 'opened',
            hash: staged.hash,
        });
        recreated.dispose();
    });

    it('releases exactly once and deletes only uncommitted unshared bytes', async () => {
        const first = await transfer.stageLocalAsset(
            new Blob(['shared-staging']),
            'first.wav',
            'asset-stage-shared-first'
        );
        const second = await transfer.stageLocalAsset(
            new Blob(['shared-staging']),
            'second.wav',
            'asset-stage-shared-second'
        );

        await expect(transfer.releaseStagedAsset(first.leaseId, first.hash)).resolves.toMatchObject({
            status: 'released',
            assetRemoved: false,
        });
        await expect(transfer.reopenStagedAsset(second.leaseId, second.hash)).resolves.toMatchObject({
            status: 'opened',
        });
        await expect(transfer.releaseStagedAsset(second.leaseId, second.hash)).resolves.toMatchObject({
            status: 'released',
            assetRemoved: true,
        });
        await expect(transfer.releaseStagedAsset(second.leaseId, second.hash)).resolves.toEqual({
            status: 'already-released',
            leaseId: second.leaseId,
            hash: second.hash,
            assetRemoved: true,
            ownerRetained: false,
        });
        await expect(transfer.reopenStagedAsset(second.leaseId, second.hash)).resolves.toEqual({
            status: 'failed',
            reason: 'lease-terminal-conflict',
        });
    });

    it('promotes exactly once without letting release undo committed ownership', async () => {
        const staged = await transfer.stageLocalAsset(
            new Blob(['commit-once']),
            'committed.wav',
            'asset-stage-commit-once'
        );

        await expect(transfer.promoteStagedAsset(staged.leaseId, staged.hash)).resolves.toMatchObject({
            status: 'promoted',
        });
        await expect(transfer.promoteStagedAsset(staged.leaseId, staged.hash)).resolves.toMatchObject({
            status: 'already-promoted',
        });
        await expect(transfer.releaseStagedAsset(staged.leaseId, staged.hash)).resolves.toEqual({
            status: 'failed',
            reason: 'lease-terminal-conflict',
        });
        await expect(transfer.reopenLocalAsset(staged.hash)).resolves.toMatchObject({ status: 'opened' });
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
        await expect(repository.rebindOwner('project:bounded-next')).resolves.toMatchObject({ status: 'rebound' });

        expect(durableAssetIndexedDb.getFullScanCount()).toBe(0);
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
