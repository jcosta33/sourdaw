import { beforeEach, describe, expect, it, vi } from 'vitest';

import { reclaimPreparedAudioBufferOrphans } from '../reclaimPreparedAudioBufferOrphans';

const mocks = vi.hoisted(() => ({
    reclaimPreparedBufferOrphans: vi.fn(),
}));

vi.mock('../../stores/audioBufferCache', () => ({
    reclaimPreparedBufferOrphans: mocks.reclaimPreparedBufferOrphans,
}));

describe('reclaimPreparedAudioBufferOrphans', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('delegates the explicit expiry boundary with the complete live lease set', async () => {
        mocks.reclaimPreparedBufferOrphans.mockResolvedValue({ status: 'reclaimed', count: 2 });
        const input = { createdBeforeMs: 4_000, liveLeaseIds: ['active-a', 'active-b'] };

        await expect(reclaimPreparedAudioBufferOrphans(input)).resolves.toEqual({
            status: 'reclaimed',
            count: 2,
        });
        expect(mocks.reclaimPreparedBufferOrphans).toHaveBeenCalledExactlyOnceWith(input);
    });

    it('returns a typed failure when orphan inspection cannot reach durable storage', async () => {
        mocks.reclaimPreparedBufferOrphans.mockRejectedValue(new Error('storage unavailable'));

        await expect(reclaimPreparedAudioBufferOrphans({ createdBeforeMs: 4_000, liveLeaseIds: [] })).resolves.toEqual({
            status: 'failed',
            reason: 'storage unavailable',
        });
    });
});
