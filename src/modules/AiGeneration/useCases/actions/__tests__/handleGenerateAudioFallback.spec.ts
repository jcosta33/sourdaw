import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleGenerateAudioFallback } from '../handleGenerateAudioFallback';

const { cacheAudioBufferMock, generateAudioMock, isAudioGenerationAvailableMock, updateTaskMock } = vi.hoisted(() => ({
    cacheAudioBufferMock: vi.fn(),
    generateAudioMock: vi.fn(),
    isAudioGenerationAvailableMock: vi.fn(),
    updateTaskMock: vi.fn(),
}));

vi.mock('#/modules/AudioAnalysis/useCases', () => ({
    generateAudio: generateAudioMock,
    isAudioGenerationAvailable: isAudioGenerationAvailableMock,
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    cacheAudioBuffer: cacheAudioBufferMock,
}));

vi.mock('../addTask', () => ({
    addTask: vi.fn().mockReturnValue('task-1'),
}));

vi.mock('../updateTask', () => ({
    updateTask: updateTaskMock,
}));

describe('handleGenerateAudioFallback', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        isAudioGenerationAvailableMock.mockReturnValue(false);
    });

    it('marks the task as error when audio generation is unavailable', async () => {
        await handleGenerateAudioFallback('prompt', '8');

        expect(generateAudioMock).not.toHaveBeenCalled();
        expect(cacheAudioBufferMock).not.toHaveBeenCalled();
        expect(updateTaskMock).toHaveBeenCalledWith(
            'task-1',
            expect.objectContaining({
                status: 'error',
            })
        );
    });

    it('should route successful generated audio caching through the AudioEngine use case', async () => {
        const channel_data = new Float32Array(256);
        const buffer: AudioBuffer = {
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
        isAudioGenerationAvailableMock.mockReturnValue(true);
        generateAudioMock.mockResolvedValue(buffer);
        cacheAudioBufferMock.mockReturnValue('generated-buffer-1');

        await handleGenerateAudioFallback('prompt', '12');

        expect(generateAudioMock).toHaveBeenCalledWith('prompt', 12);
        expect(cacheAudioBufferMock).toHaveBeenCalledWith({ buffer });
        expect(updateTaskMock).toHaveBeenCalledWith(
            'task-1',
            expect.objectContaining({
                status: 'success',
                data: { format: 'wav', lengthSeconds: 12 },
            })
        );
    });

    it('should mark the task as error when generated audio caching fails', async () => {
        const channel_data = new Float32Array(256);
        const buffer: AudioBuffer = {
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
        isAudioGenerationAvailableMock.mockReturnValue(true);
        generateAudioMock.mockResolvedValue(buffer);
        cacheAudioBufferMock.mockImplementation(() => {
            throw new Error('cache exploded');
        });

        await handleGenerateAudioFallback('prompt', '12');

        expect(updateTaskMock).toHaveBeenCalledWith(
            'task-1',
            expect.objectContaining({
                status: 'error',
                error: 'cache exploded',
            })
        );
    });
});
