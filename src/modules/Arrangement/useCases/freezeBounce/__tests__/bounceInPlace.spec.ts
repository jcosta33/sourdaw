import { beforeEach, describe, expect, it, vi } from 'vitest';

import { bounceInPlace } from '../bounceInPlace';

import type { BounceOptions } from '../bounceTrack';

const mocks = vi.hoisted(() => ({
    bounceTrack: vi.fn<(trackId: string, options: BounceOptions) => Promise<boolean>>(),
}));

vi.mock('../bounceTrack', () => ({
    bounceTrack: mocks.bounceTrack,
}));

describe('bounceInPlace', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should bounce the track with the exact in-place preset', async () => {
        mocks.bounceTrack.mockResolvedValue(true);
        const didWrite = await bounceInPlace('track-42');

        expect(mocks.bounceTrack).toHaveBeenCalledTimes(1);
        expect(mocks.bounceTrack).toHaveBeenCalledWith('track-42', {
            includeInserts: true,
            includeSends: false,
            includeAutomation: true,
            normalization: 'protection',
            tailHandling: 'auto',
            destination: 'replace',
        });
        expect(didWrite).toBe(true);
    });

    it('forwards undo-entry suppression to the bounce and leaves the preset otherwise intact', async () => {
        mocks.bounceTrack.mockResolvedValue(true);

        await bounceInPlace('track-42', { recordUndoEntry: false });

        expect(mocks.bounceTrack).toHaveBeenCalledWith('track-42', {
            includeInserts: true,
            includeSends: false,
            includeAutomation: true,
            normalization: 'protection',
            tailHandling: 'auto',
            destination: 'replace',
            recordUndoEntry: false,
        });
    });

    it('propagates a rejected bounce as no-write', async () => {
        mocks.bounceTrack.mockResolvedValue(false);

        await expect(bounceInPlace('vca-1')).resolves.toBe(false);
    });
});
