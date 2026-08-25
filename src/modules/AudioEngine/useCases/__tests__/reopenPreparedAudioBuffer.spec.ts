import { beforeEach, describe, expect, it, vi } from 'vitest';

import { reopenPreparedAudioBuffer } from '../reopenPreparedAudioBuffer';

const mocks = vi.hoisted(() => ({
    context: { createBuffer: vi.fn() },
    getAudioContext: vi.fn(),
    reopenPreparedBuffer: vi.fn(),
}));

vi.mock('../../stores/audioBufferCache', () => ({
    audioBufferCache: { reopenPreparedBuffer: mocks.reopenPreparedBuffer },
}));
vi.mock('../engineAccess/getAudioContext', () => ({
    getAudioContext: mocks.getAudioContext,
}));

describe('reopenPreparedAudioBuffer', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getAudioContext.mockReturnValue(mocks.context);
    });

    it('reopens the exact persisted buffer and lease into the live cache', async () => {
        mocks.reopenPreparedBuffer.mockResolvedValue({
            status: 'reopened',
            bufferId: 'prepared-buffer',
            ownership: 'temporary',
        });

        await expect(
            reopenPreparedAudioBuffer({ bufferId: 'prepared-buffer', leaseId: 'prepared-lease' })
        ).resolves.toEqual({ status: 'reopened', bufferId: 'prepared-buffer', ownership: 'temporary' });
        expect(mocks.reopenPreparedBuffer).toHaveBeenCalledExactlyOnceWith({
            id: 'prepared-buffer',
            leaseId: 'prepared-lease',
            context: mocks.context,
        });
    });

    it('returns a typed failure when the audio runtime is unavailable', async () => {
        mocks.getAudioContext.mockImplementation(() => {
            throw new Error('AudioContext unavailable');
        });

        await expect(
            reopenPreparedAudioBuffer({ bufferId: 'prepared-buffer', leaseId: 'prepared-lease' })
        ).resolves.toEqual({ status: 'failed', reason: 'AudioContext unavailable' });
        expect(mocks.reopenPreparedBuffer).not.toHaveBeenCalled();
    });
});
