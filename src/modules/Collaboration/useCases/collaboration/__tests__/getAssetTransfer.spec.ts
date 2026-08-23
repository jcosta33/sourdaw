import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type AssetTransfer } from '../../assetTransfer';
import { getAssetTransfer } from '../getAssetTransfer';

/**
 * `getAssetTransfer` is a thin accessor over `sessionManagement`'s
 * `sessionRuntimePrimitives` shared state. Mock that boundary so the spec
 * asserts the accessor itself, not the real asset-transfer subsystem.
 */
const mockRuntime = vi.hoisted(() => ({
    state: {
        assetTransfer: null as AssetTransfer | null,
    },
}));
const mocks = vi.hoisted(() => ({
    ownerId: 'aaaaaaaa-aaaa-8aaa-8aaa-aaaaaaaaaaaa',
    durable: new Map<string, { hash: string; blob: Blob; name: string }>(),
    transfers: [] as Array<{
        dispose: ReturnType<typeof vi.fn>;
        reopenDurableStagedAsset: ReturnType<typeof vi.fn>;
        stageDurableAsset: ReturnType<typeof vi.fn>;
    }>,
}));

vi.mock('../sessionManagement', () => ({ sessionRuntimePrimitives: mockRuntime }));
vi.mock('../getCollaborationAssetOwnerId', () => ({
    collaborationAssetOwnership: { getOwnerId: () => mocks.ownerId },
}));
vi.mock('../../../repositories/peerConnection', () => ({
    PeerConnectionManager: vi.fn().mockImplementation(function () {
        return {};
    }),
}));
vi.mock('../../assetTransfer', () => ({
    AssetTransfer: vi.fn().mockImplementation(function () {
        const transfer = {
            dispose: vi.fn(),
            stageDurableAsset: vi.fn(async (blob: Blob, name: string, leaseId: string) => {
                const hash = `hash:${name}`;
                mocks.durable.set(leaseId, { hash, blob, name });
                return { hash, leaseId };
            }),
            reopenDurableStagedAsset: vi.fn(async (leaseId: string, expectedHash: string) => {
                const stored = mocks.durable.get(leaseId);
                return stored?.hash === expectedHash
                    ? { status: 'opened', leaseId, hash: stored.hash, blob: stored.blob, name: stored.name }
                    : { status: 'failed', reason: 'unknown-lease' };
            }),
        };
        mocks.transfers.push(transfer);
        return transfer;
    }),
}));

describe('getAssetTransfer', () => {
    beforeEach(() => {
        mockRuntime.state.assetTransfer = null;
        mocks.ownerId = 'aaaaaaaa-aaaa-8aaa-8aaa-aaaaaaaaaaaa';
        mocks.durable.clear();
        mocks.transfers.length = 0;
    });

    it('returns a project-owned durable transfer when no collaboration session is active', () => {
        expect(getAssetTransfer()).toBeDefined();
        expect(mocks.transfers).toHaveLength(1);
    });

    it('returns the active asset transfer instance from runtime state', () => {
        const activeTransfer = { getAsset: vi.fn() } as unknown as AssetTransfer;
        mockRuntime.state.assetTransfer = activeTransfer;

        expect(getAssetTransfer()).toBe(activeTransfer);
    });

    it('recreates the project transfer when the settled owner identity changes', () => {
        const first = getAssetTransfer();
        mocks.ownerId = 'bbbbbbbb-bbbb-8bbb-8bbb-bbbbbbbbbbbb';

        const second = getAssetTransfer();

        expect(second).not.toBe(first);
        expect(mocks.transfers[0]?.dispose).toHaveBeenCalledOnce();
    });

    it('reopens no-session durable staging after the project transfer is recreated', async () => {
        const activeSessionTransfer = { dispose: vi.fn() } as unknown as AssetTransfer;
        mockRuntime.state.assetTransfer = activeSessionTransfer;
        getAssetTransfer();
        mockRuntime.state.assetTransfer = null;
        const preparing = getAssetTransfer();
        if (!preparing) {
            throw new TypeError('Expected project asset transfer');
        }
        const staged = await preparing.stageDurableAsset(
            new File(['durable stem'], 'stem.wav'),
            'stem.wav',
            'lease:no-session-stem'
        );
        mockRuntime.state.assetTransfer = activeSessionTransfer;
        getAssetTransfer();
        mockRuntime.state.assetTransfer = null;

        const recreated = getAssetTransfer();

        await expect(recreated?.reopenDurableStagedAsset(staged.leaseId, staged.hash)).resolves.toMatchObject({
            status: 'opened',
            leaseId: staged.leaseId,
            hash: staged.hash,
        });
    });
});
