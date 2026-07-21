import { beforeEach, describe, expect, it, vi } from 'vitest';

import { bounceToNewTrack } from '../bounceToNewTrack';

import type { BounceOptions } from '../bounceTrack';

const mocks = vi.hoisted(() => ({
    bounceTrack: vi.fn<(trackId: string, options: BounceOptions) => Promise<boolean>>(),
}));

vi.mock('../bounceTrack', () => ({
    bounceTrack: mocks.bounceTrack,
}));

describe('bounceToNewTrack', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should bounce the track with the exact new-track preset', async () => {
        mocks.bounceTrack.mockResolvedValue(true);
        const didWrite = await bounceToNewTrack('track-42');

        expect(mocks.bounceTrack).toHaveBeenCalledTimes(1);
        expect(mocks.bounceTrack).toHaveBeenCalledWith('track-42', {
            includeInserts: true,
            includeSends: false,
            includeAutomation: true,
            normalization: 'protection',
            tailHandling: 'auto',
            destination: 'new-track',
        });
        expect(didWrite).toBe(true);
    });

    it('propagates a rejected bounce as no-write', async () => {
        mocks.bounceTrack.mockResolvedValue(false);

        await expect(bounceToNewTrack('vca-1')).resolves.toBe(false);
    });
});
