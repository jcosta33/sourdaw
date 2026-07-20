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

vi.mock('../sessionManagement', () => ({ sessionRuntimePrimitives: mockRuntime }));

describe('getAssetTransfer', () => {
    beforeEach(() => {
        mockRuntime.state.assetTransfer = null;
    });

    it('returns null when there is no active asset transfer', () => {
        expect(getAssetTransfer()).toBeNull();
    });

    it('returns the active asset transfer instance from runtime state', () => {
        const activeTransfer = { getAsset: vi.fn() } as unknown as AssetTransfer;
        mockRuntime.state.assetTransfer = activeTransfer;

        expect(getAssetTransfer()).toBe(activeTransfer);
    });
});
