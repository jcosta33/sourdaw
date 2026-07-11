import { beforeEach, describe, expect, it, vi } from 'vitest';

import { bounceInPlace } from '../bounceInPlace';

import type { BounceOptions } from '../bounceTrack';

const mocks = vi.hoisted(() => ({
    bounceTrack: vi.fn<(trackId: string, options: BounceOptions) => Promise<void>>(),
}));

vi.mock('../bounceTrack', () => ({
    bounceTrack: mocks.bounceTrack,
}));

describe('bounceInPlace', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should bounce the track with the exact in-place preset', async () => {
        await bounceInPlace('track-42');

        expect(mocks.bounceTrack).toHaveBeenCalledTimes(1);
        expect(mocks.bounceTrack).toHaveBeenCalledWith('track-42', {
            includeInserts: true,
            includeSends: false,
            includeAutomation: true,
            normalization: 'protection',
            tailHandling: 'auto',
            destination: 'replace',
        });
    });
});
