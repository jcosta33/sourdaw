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

    it('preserves one live confirmation stage across no-session and session transfer swaps', async () => {
        const projectTransfer = getAssetTransfer();
        if (!projectTransfer) {
            throw new TypeError('Expected project asset transfer');
        }
        const staged = await projectTransfer.stageDurableAsset(
            new Blob(['pending-confirmation']),
            'pending-confirmation.wav',
            'asset-stage-project-session-swap'
        );
        projectTransfer.protectDurableStagedAssetAcrossTransfer(staged.leaseId);

        const sessionTransfer = createSessionTransfer();
        runtime.state.assetTransfer = sessionTransfer;
        expect(getAssetTransfer()).toBe(sessionTransfer);
        await sessionTransfer.reopenDurableAsset('sha256:missing');

        runtime.state.assetTransfer = null;
        const replacementProjectTransfer = getAssetTransfer();
        await replacementProjectTransfer?.reopenDurableAsset('sha256:missing');

        await expect(
            replacementProjectTransfer?.reopenDurableStagedAsset(staged.leaseId, staged.hash)
        ).resolves.toMatchObject({ status: 'opened', leaseId: staged.leaseId });
        await expect(
            replacementProjectTransfer?.releaseDurableStagedAsset(staged.leaseId, staged.hash)
        ).resolves.toMatchObject({ status: 'released' });

        const cleanupTransfer = createSessionTransfer();
        runtime.state.assetTransfer = cleanupTransfer;
        getAssetTransfer();
        await cleanupTransfer.reopenDurableAsset('sha256:missing');
        await expect(cleanupTransfer.reopenDurableStagedAsset(staged.leaseId, staged.hash)).resolves.toEqual({
            status: 'failed',
            reason: 'lease-terminal-conflict',
        });
        cleanupTransfer.dispose();
    });
});
