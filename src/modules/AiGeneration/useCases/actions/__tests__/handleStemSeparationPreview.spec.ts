import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleStemSeparationPreview } from '../handleStemSeparationPreview';

const { audioBufferToWavMock, cacheAudioBufferMock, getCachedAudioBufferMock, separateStemsMock, updateTaskMock } =
    vi.hoisted(() => ({
        audioBufferToWavMock: vi.fn(),
        cacheAudioBufferMock: vi.fn(),
        getCachedAudioBufferMock: vi.fn(),
        separateStemsMock: vi.fn(),
        updateTaskMock: vi.fn(),
    }));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    audioBufferToWav: audioBufferToWavMock,
    cacheAudioBuffer: cacheAudioBufferMock,
    getCachedAudioBuffer: getCachedAudioBufferMock,
}));

const create_test_audio_buffer = (): AudioBuffer => {
    const channel_data = new Float32Array(128);
    return {
        copyFromChannel: (destination, _channel_number, start_in_channel = 0) => {
            destination.set(channel_data.subarray(start_in_channel, start_in_channel + destination.length));
        },
        copyToChannel: (source, _channel_number, start_in_channel = 0) => {
            channel_data.set(source, start_in_channel);
        },
        duration: channel_data.length / 48_000,
        getChannelData: () => channel_data,
        length: channel_data.length,
        numberOfChannels: 1,
        sampleRate: 48_000,
    };
};

vi.mock('#/modules/AudioAnalysis/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/AudioAnalysis/useCases')>();
    return {
        ...actual,
        separateStems: separateStemsMock,
    };
});

vi.mock('../addTask', () => ({
    addTask: vi.fn().mockReturnValue('task-1'),
}));

vi.mock('../updateTask', () => ({
    updateTask: updateTaskMock,
}));

describe('handleStemSeparationPreview', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getCachedAudioBufferMock.mockReturnValue(null);
    });

    it('records an error task when the clip buffer is missing', async () => {
        await handleStemSeparationPreview('missing-buffer-id');

        expect(getCachedAudioBufferMock).toHaveBeenCalledWith({ bufferId: 'missing-buffer-id' });
        expect(separateStemsMock).not.toHaveBeenCalled();
        expect(updateTaskMock).toHaveBeenCalledWith(
            'task-1',
            expect.objectContaining({
                status: 'error',
            })
        );
    });

    it('includes durationMs on the error task so failed runs carry a duration', async () => {
        await handleStemSeparationPreview('missing-buffer-id');

        // The error path must carry a numeric duration like the success path and
        // the sibling handlers, so a failed stem-separation task is not duration-less.
        expect(updateTaskMock).toHaveBeenCalledWith(
            'task-1',
            expect.objectContaining({
                status: 'error',
                durationMs: expect.any(Number),
            })
        );
    });

    it('should route successful stem preview cache reads and writes through AudioEngine use cases', async () => {
        const source_buffer = create_test_audio_buffer();
        const wav_data = new ArrayBuffer(10);
        const vocals_buffer = create_test_audio_buffer();
        const drums_buffer = create_test_audio_buffer();

        getCachedAudioBufferMock.mockReturnValue(source_buffer);
        audioBufferToWavMock.mockResolvedValue(wav_data);
        separateStemsMock.mockResolvedValue({
            vocals: vocals_buffer,
            drums: drums_buffer,
        });

        await handleStemSeparationPreview('clip-1');

        expect(getCachedAudioBufferMock).toHaveBeenCalledWith({ bufferId: 'clip-1' });
        expect(audioBufferToWavMock).toHaveBeenCalledWith(source_buffer);
        expect(separateStemsMock).toHaveBeenCalledWith(wav_data, ['all']);
        expect(cacheAudioBufferMock).toHaveBeenCalledWith({ buffer: vocals_buffer, bufferId: 'clip-1-vocals' });
        expect(cacheAudioBufferMock).toHaveBeenCalledWith({ buffer: drums_buffer, bufferId: 'clip-1-drums' });
        expect(updateTaskMock).toHaveBeenCalledWith(
            'task-1',
            expect.objectContaining({
                status: 'success',
                data: { clipId: 'clip-1', stems: ['vocals', 'drums'] },
                durationMs: expect.any(Number),
            })
        );
    });
});
