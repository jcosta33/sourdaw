import { beforeEach, describe, expect, it, vi } from 'vitest';

import { exportCachedAudioBuffers } from '../exportCachedAudioBuffers';

const mocks = vi.hoisted(() => ({
    exportBuffers: vi.fn(),
}));

vi.mock('../../stores/audioBufferCache', () => ({
    audioBufferCache: {
        exportBuffers: mocks.exportBuffers,
    },
}));

describe('exportCachedAudioBuffers', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.exportBuffers.mockResolvedValue({});
    });

    it('should export requested cached audio buffers from the audio buffer cache', async () => {
        const buffer_ids = ['clip-buffer-1', 'frozen-buffer-2'];
        const exported_buffers = {
            'clip-buffer-1': {
                sampleRate: 48_000,
                numberOfChannels: 1,
                channelData: ['encoded-clip'],
            },
        };
        mocks.exportBuffers.mockResolvedValue(exported_buffers);

        const result = await exportCachedAudioBuffers({ bufferIds: buffer_ids });

        expect(result).toBe(exported_buffers);
        expect(mocks.exportBuffers).toHaveBeenCalledWith(buffer_ids);
    });
});
