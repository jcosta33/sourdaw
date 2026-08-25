import { beforeEach, describe, expect, it, vi } from 'vitest';

import { persistPreparedAudioBuffer } from '../persistPreparedAudioBuffer';

const mocks = vi.hoisted(() => ({
    persistPreparedBuffer: vi.fn(),
}));

vi.mock('../../stores/audioBufferCache', () => ({
    audioBufferCache: { persistPreparedBuffer: mocks.persistPreparedBuffer },
}));

describe('persistPreparedAudioBuffer', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns the exact durable lease reported after the cache transaction commits', async () => {
        const buffer = {} as AudioBuffer;
        mocks.persistPreparedBuffer.mockResolvedValue({
            status: 'persisted',
            bufferId: 'prepared-buffer',
            leaseId: 'prepared-lease',
        });

        await expect(
            persistPreparedAudioBuffer({ bufferId: 'prepared-buffer', buffer, leaseId: 'prepared-lease' })
        ).resolves.toEqual({
            status: 'persisted',
            bufferId: 'prepared-buffer',
            leaseId: 'prepared-lease',
        });
        expect(mocks.persistPreparedBuffer).toHaveBeenCalledExactlyOnceWith({
            id: 'prepared-buffer',
            buffer,
            leaseId: 'prepared-lease',
        });
    });

    it('returns a typed failure when the cache cannot create a durable candidate', async () => {
        mocks.persistPreparedBuffer.mockRejectedValue(new Error('PCM serialization failed'));

        await expect(
            persistPreparedAudioBuffer({
                bufferId: 'prepared-buffer',
                buffer: {} as AudioBuffer,
                leaseId: 'prepared-lease',
            })
        ).resolves.toEqual({ status: 'failed', reason: 'PCM serialization failed' });
    });
});
