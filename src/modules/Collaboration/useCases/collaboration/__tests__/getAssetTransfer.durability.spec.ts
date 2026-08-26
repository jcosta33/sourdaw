import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { PeerConnectionManager } from '../../../repositories/peerConnection';
import {
    installFakeDurableAssetIndexedDb,
    type FakeDurableAssetIndexedDb,
} from '../../__tests__/fakeDurableAssetIndexedDb';
import { AssetTransfer } from '../../assetTransfer';
import { getAssetTransfer } from '../getAssetTransfer';

const OWNER_ID = 'aaaaaaaa-aaaa-8aaa-8aaa-aaaaaaaaaaaa';

const runtime = vi.hoisted(() => ({
    state: { assetTransfer: null as AssetTransfer | null },
}));

vi.mock('../sessionManagement', () => ({ sessionRuntimePrimitives: runtime }));
vi.mock('../getCollaborationAssetOwnerId', () => ({
    collaborationAssetOwnership: { getOwnerId: () => OWNER_ID },
}));

let durableAssetIndexedDb: FakeDurableAssetIndexedDb;

beforeAll(() => {
    durableAssetIndexedDb = installFakeDurableAssetIndexedDb();
});

function createSessionTransfer(): AssetTransfer {
    return new AssetTransfer(
        new PeerConnectionManager({
            onMessage: () => undefined,
            onConnected: () => undefined,
            onDisconnected: () => undefined,
        }),
        {
            onAssetAvailable: () => undefined,
            onProgress: () => undefined,
            onTransferFailed: () => undefined,
        },
        OWNER_ID
    );
}

describe('getAssetTransfer durable live-stage ownership', () => {
    beforeEach(() => {
        durableAssetIndexedDb.reset();
        runtime.state.assetTransfer = null;
    });

    it('preserves one transfer-safe stage across no-session and session swaps before confirmation owns it', async () => {
        const projectTransfer = getAssetTransfer();
        if (!projectTransfer) {
            throw new TypeError('Expected project asset transfer');
        }
        const promoted = await projectTransfer.stageDurableAsset(
            new Blob(['pending-confirmation-promote']),
            'pending-confirmation-promote.wav',
            'asset-stage-project-session-swap-promote',
            { protectAcrossTransfer: true }
        );
        const cancelled = await projectTransfer.stageDurableAsset(
            new Blob(['pending-confirmation-cancel']),
            'pending-confirmation-cancel.wav',
            'asset-stage-project-session-swap-cancel',
            { protectAcrossTransfer: true }
        );

        const sessionTransfer = createSessionTransfer();
        runtime.state.assetTransfer = sessionTransfer;
        expect(getAssetTransfer()).toBe(sessionTransfer);
        await sessionTransfer.reopenDurableAsset('sha256:missing');

        runtime.state.assetTransfer = null;
        const replacementProjectTransfer = getAssetTransfer();
        await replacementProjectTransfer?.reopenDurableAsset('sha256:missing');

        await expect(
            replacementProjectTransfer?.reopenDurableStagedAsset(promoted.leaseId, promoted.hash)
        ).resolves.toMatchObject({ status: 'opened', leaseId: promoted.leaseId });
        await expect(
            replacementProjectTransfer?.reopenDurableStagedAsset(cancelled.leaseId, cancelled.hash)
        ).resolves.toMatchObject({ status: 'opened', leaseId: cancelled.leaseId });
        await expect(
            replacementProjectTransfer?.prepareDurablePromotionRecovery('stem-promotion:session-swap', [
                { leaseId: promoted.leaseId, expectedHash: promoted.hash },
            ])
        ).resolves.toMatchObject({ status: 'prepared' });
        await expect(
            replacementProjectTransfer?.commitDurablePromotionRecovery('stem-promotion:session-swap')
        ).resolves.toMatchObject({ status: 'committed' });
        await expect(
            replacementProjectTransfer?.completeDurablePromotionRecovery('stem-promotion:session-swap')
        ).resolves.toMatchObject({ status: 'completed' });
        await expect(
            replacementProjectTransfer?.prepareDurableCleanupRecovery('stem-cleanup:session-swap', [
                { leaseId: cancelled.leaseId, expectedHash: cancelled.hash },
            ])
        ).resolves.toMatchObject({ status: 'prepared' });
        await expect(
            replacementProjectTransfer?.completeDurableCleanupRecovery('stem-cleanup:session-swap')
        ).resolves.toMatchObject({ status: 'completed' });

        const cleanupTransfer = createSessionTransfer();
        runtime.state.assetTransfer = cleanupTransfer;
        getAssetTransfer();
        await cleanupTransfer.reopenDurableAsset('sha256:missing');
        await expect(cleanupTransfer.reopenDurableAsset(promoted.hash)).resolves.toMatchObject({
            status: 'opened',
            hash: promoted.hash,
        });
        await expect(cleanupTransfer.reopenDurableStagedAsset(cancelled.leaseId, cancelled.hash)).resolves.toEqual({
            status: 'failed',
            reason: 'lease-terminal-conflict',
        });
        await cleanupTransfer.releaseDurableAsset(promoted.hash);
        cleanupTransfer.dispose();
    });
});
