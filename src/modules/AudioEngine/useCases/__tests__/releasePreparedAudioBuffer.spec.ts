import { beforeEach, describe, expect, it, vi } from 'vitest';

import { releasePreparedAudioBuffer } from '../releasePreparedAudioBuffer';

const mocks = vi.hoisted(() => ({
    releasePreparedBuffer: vi.fn(),
}));

vi.mock('../../stores/audioBufferCache', () => ({
    audioBufferCache: { releasePreparedBuffer: mocks.releasePreparedBuffer },
}));

describe('releasePreparedAudioBuffer', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('delegates exact project transfer without deleting the durable PCM', async () => {
        mocks.releasePreparedBuffer.mockResolvedValue({ status: 'released', disposition: 'project-owned' });

        await expect(
            releasePreparedAudioBuffer({
                bufferId: 'prepared-buffer',
                leaseId: 'prepared-lease',
                disposition: 'project-owned',
            })
        ).resolves.toEqual({ status: 'released', disposition: 'project-owned' });
        expect(mocks.releasePreparedBuffer).toHaveBeenCalledExactlyOnceWith({
            id: 'prepared-buffer',
            leaseId: 'prepared-lease',
            disposition: 'project-owned',
        });
    });

    it('returns a typed failure when settlement cannot reach durable storage', async () => {
        mocks.releasePreparedBuffer.mockRejectedValue(new Error('settlement unavailable'));

        await expect(
            releasePreparedAudioBuffer({
                bufferId: 'prepared-buffer',
                leaseId: 'prepared-lease',
                disposition: 'discard',
            })
        ).resolves.toEqual({ status: 'failed', reason: 'settlement unavailable' });
    });
});
