import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleAiDenoiseClip } from '../handleAiDenoiseClip';

const { cacheAudioBufferMock, denoiseAudioMock, getCachedAudioBufferMock, isDesktopMock, updateTaskMock } = vi.hoisted(
    () => ({
        cacheAudioBufferMock: vi.fn(),
        denoiseAudioMock: vi.fn(),
        getCachedAudioBufferMock: vi.fn(),
        isDesktopMock: vi.fn(),
        updateTaskMock: vi.fn(),
    })
);

vi.mock('#/modules/AudioEngine/useCases', () => ({
    cacheAudioBuffer: cacheAudioBufferMock,
    getCachedAudioBuffer: getCachedAudioBufferMock,
}));

vi.mock('../../nativeAiBridge/denoiseAudio', () => ({
    denoiseAudio: denoiseAudioMock,
}));

vi.mock('#/utils/desktopRuntime', () => ({
    isDesktopRuntime: isDesktopMock,
}));

vi.mock('../addTask', () => ({
    addTask: vi.fn().mockReturnValue('task-1'),
}));

vi.mock('../updateTask', () => ({
    updateTask: updateTaskMock,
}));

const create_test_audio_buffer = (
    samples: Float32Array<ArrayBuffer> | Float32Array<ArrayBuffer>[],
    sample_rate: number = 48_000
): AudioBuffer => {
    const channels = samples instanceof Float32Array ? [samples] : samples;
    const frame_length = channels[0]?.length ?? 0;
    return {
        copyFromChannel: (destination, channel_number, start_in_channel = 0) => {
            destination.set(
                channels[channel_number]!.subarray(start_in_channel, start_in_channel + destination.length)
            );
        },
        copyToChannel: (source, channel_number, start_in_channel = 0) => {
            channels[channel_number]!.set(source, start_in_channel);
        },
        duration: frame_length / sample_rate,
        getChannelData: (channel_number) => channels[channel_number]!,
        length: frame_length,
        numberOfChannels: channels.length,
        sampleRate: sample_rate,
    };
};

class TestOfflineAudioContext {
    constructor(
        _number_of_channels: number,
        private readonly length: number,
        private readonly sample_rate: number
    ) {}

    createBuffer(number_of_channels: number, length: number, sample_rate: number): AudioBuffer {
        const channels = Array.from({ length: number_of_channels }, () => new Float32Array(length || this.length));
        return create_test_audio_buffer(channels, sample_rate || this.sample_rate);
    }
}

describe('handleAiDenoiseClip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal('OfflineAudioContext', TestOfflineAudioContext);
        getCachedAudioBufferMock.mockReturnValue(null);
        isDesktopMock.mockReturnValue(false);
    });

    it('records an error task when the clip buffer is missing', async () => {
        await handleAiDenoiseClip('missing-buffer-id');

        expect(getCachedAudioBufferMock).toHaveBeenCalledWith({ bufferId: 'missing-buffer-id' });
        expect(denoiseAudioMock).not.toHaveBeenCalled();
        expect(cacheAudioBufferMock).not.toHaveBeenCalled();
        expect(updateTaskMock).toHaveBeenCalledWith(
            'task-1',
            expect.objectContaining({
                status: 'error',
            })
        );
    });

    it('should route the desktop denoise path through AudioEngine cache use cases', async () => {
        const source_samples = new Float32Array([0.1, 0.2, 0.3, 0.4]);
        const source_buffer = create_test_audio_buffer(source_samples);
        const denoised_samples = new Float32Array([0.01, 0.02, 0.03, 0.04]);

        getCachedAudioBufferMock.mockReturnValue(source_buffer);
        isDesktopMock.mockReturnValue(true);
        denoiseAudioMock.mockResolvedValue({
            noise_floor_db: -42,
            samples: denoised_samples,
        });

        await handleAiDenoiseClip('clip-1', 0.5);

        expect(getCachedAudioBufferMock).toHaveBeenCalledWith({ bufferId: 'clip-1' });
        expect(denoiseAudioMock).toHaveBeenCalledWith(source_samples, 48_000, 1, 0.5);
        expect(cacheAudioBufferMock).toHaveBeenCalledWith({
            buffer: expect.objectContaining({
                length: denoised_samples.length,
                sampleRate: 48_000,
            }),
            bufferId: 'clip-1-denoised',
        });
        expect(updateTaskMock).toHaveBeenCalledWith(
            'task-1',
            expect.objectContaining({
                status: 'success',
                data: { clipId: 'clip-1', noiseFloorDb: -42 },
                durationMs: expect.any(Number),
            })
        );
    });

    it('passes the dry signal through bit-exactly at strength 0 in the browser fallback', async () => {
        const source_samples = new Float32Array([0.001, -0.003, 0.5, -0.5, 0.02, -0.007]);
        getCachedAudioBufferMock.mockReturnValue(create_test_audio_buffer(source_samples.slice()));

        await handleAiDenoiseClip('clip-identity', 0);

        const cached_buffer = cacheAudioBufferMock.mock.calls[0]![0].buffer as AudioBuffer;
        const output = cached_buffer.getChannelData(0);
        expect(output).toStrictEqual(source_samples);
    });

    it('preserves distinct stereo channels in the browser fallback', async () => {
        const left = new Float32Array([0.01, -0.02, 0.03, -0.04]);
        const right = new Float32Array([0.4, 0.3, -0.2, -0.1]);
        getCachedAudioBufferMock.mockReturnValue(create_test_audio_buffer([left.slice(), right.slice()]));

        await handleAiDenoiseClip('clip-stereo-browser', 0);

        const cached_buffer = cacheAudioBufferMock.mock.calls[0]![0].buffer as AudioBuffer;
        expect(cached_buffer.numberOfChannels).toBe(2);
        expect(cached_buffer.length).toBe(left.length);
        expect(cached_buffer.getChannelData(0)).toStrictEqual(left);
        expect(cached_buffer.getChannelData(1)).toStrictEqual(right);
        expect(cached_buffer.getChannelData(1)).not.toStrictEqual(cached_buffer.getChannelData(0));
    });

    it('sends planar stereo samples to native denoise and caches its stereo result', async () => {
        const left = new Float32Array([0.1, 0.2, 0.3]);
        const right = new Float32Array([-0.4, -0.5, -0.6]);
        const denoised_left = new Float32Array([0.01, 0.02, 0.03]);
        const denoised_right = new Float32Array([-0.04, -0.05, -0.06]);
        getCachedAudioBufferMock.mockReturnValue(create_test_audio_buffer([left, right]));
        isDesktopMock.mockReturnValue(true);
        denoiseAudioMock.mockResolvedValue({
            noise_floor_db: -36,
            samples: new Float32Array([...denoised_left, ...denoised_right]),
        });

        await handleAiDenoiseClip('clip-stereo-desktop', 0.5);

        expect(denoiseAudioMock).toHaveBeenCalledWith(new Float32Array([...left, ...right]), 48_000, 2, 0.5);
        const cached_buffer = cacheAudioBufferMock.mock.calls[0]![0].buffer as AudioBuffer;
        expect(cached_buffer.numberOfChannels).toBe(2);
        expect(cached_buffer.length).toBe(left.length);
        expect(cached_buffer.getChannelData(0)).toStrictEqual(denoised_left);
        expect(cached_buffer.getChannelData(1)).toStrictEqual(denoised_right);
    });

    // Mirrors the Rust pin
    // `steady_state_depth_at_the_noise_floor_matches_the_pin_through_the_full_path`
    // in crates/sourdaw-native/src/commands/ai_audio.rs: the same Denoise
    // action must render the same audio in browser and native. A constant
    // ±0.01 clip is its own noise floor, the envelope settles at 0.01, and
    // the steady-state gain at the shipped strength 0.7 is
    // (1 / sqrt(3.1)) ** 3.5 ≈ 0.1382 (−17.2 dB).
    it('attenuates noise-floor material by the pinned depth at the shipped strength', async () => {
        const source_samples = new Float32Array(4800);
        for (let index = 0; index < source_samples.length; index++) {
            source_samples[index] = index % 2 === 0 ? 0.01 : -0.01;
        }
        getCachedAudioBufferMock.mockReturnValue(create_test_audio_buffer(source_samples));

        await handleAiDenoiseClip('clip-depth', 0.7);

        const cached_buffer = cacheAudioBufferMock.mock.calls[0]![0].buffer as AudioBuffer;
        const output = cached_buffer.getChannelData(0);
        const tail = Math.abs(output[4799]!);
        const expected = 0.01 * 0.13816;
        expect(Math.abs(tail - expected)).toBeLessThan(0.02 * expected);
    });

    it('should route the browser denoise fallback through AudioEngine cache use cases', async () => {
        const source_buffer = create_test_audio_buffer(new Float32Array([0.001, -0.001, 0.5, -0.5]));

        getCachedAudioBufferMock.mockReturnValue(source_buffer);

        await handleAiDenoiseClip('clip-2', 0.25);

        expect(getCachedAudioBufferMock).toHaveBeenCalledWith({ bufferId: 'clip-2' });
        expect(denoiseAudioMock).not.toHaveBeenCalled();
        expect(cacheAudioBufferMock).toHaveBeenCalledWith({
            buffer: expect.objectContaining({
                length: source_buffer.length,
                sampleRate: 48_000,
            }),
            bufferId: 'clip-2-denoised',
        });
        expect(updateTaskMock).toHaveBeenCalledWith(
            'task-1',
            expect.objectContaining({
                status: 'success',
                data: expect.objectContaining({ clipId: 'clip-2' }),
                durationMs: expect.any(Number),
            })
        );
    });
});
