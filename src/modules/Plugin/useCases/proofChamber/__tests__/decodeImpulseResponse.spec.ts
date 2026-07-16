import { beforeEach, describe, expect, it, vi } from 'vitest';

import { decodeImpulseResponse } from '../decodeImpulseResponse';

const mocks = vi.hoisted(() => ({
    decodeAudioFileBuffer: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    decodeAudioFileBuffer: mocks.decodeAudioFileBuffer,
}));

function makeFile(): File {
    return new File([new Uint8Array([1, 2, 3, 4])], 'hall.wav', { type: 'audio/wav' });
}

function makeAudioBuffer(): AudioBuffer {
    const left = new Float32Array(400);
    const right = new Float32Array(400);
    left[0] = 0.25;
    left[1] = 0.5;
    left[2] = 0.75;
    left[3] = 0.1;
    right[0] = -0.25;
    right[1] = -0.5;

    return {
        numberOfChannels: 2,
        length: 400,
        sampleRate: 48_000,
        getChannelData: (channel: number) => (channel === 0 ? left : right),
    } as AudioBuffer;
}

function makeMonoAudioBuffer(samples: number[]): AudioBuffer {
    const mono = new Float32Array(samples);

    return {
        numberOfChannels: 1,
        length: mono.length,
        sampleRate: 48_000,
        getChannelData: () => mono,
    } as AudioBuffer;
}

describe('decodeImpulseResponse', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('orchestrates the AudioEngine decode contract into interleaved data and preview peaks', async () => {
        const file = makeFile();
        const arrayBuffer = vi.spyOn(file, 'arrayBuffer');
        mocks.decodeAudioFileBuffer.mockResolvedValue(makeAudioBuffer());

        const result = await decodeImpulseResponse(file);

        expect(mocks.decodeAudioFileBuffer).toHaveBeenCalledWith(file);
        expect(arrayBuffer).not.toHaveBeenCalled();
        expect(result.channels).toBe(2);
        expect(result.sampleRate).toBe(48_000);
        expect(result.data.slice(0, 6)).toEqual(new Float32Array([0.25, -0.25, 0.5, -0.5, 0.75, 0]));
        expect(result.waveform).toHaveLength(200);
        expect(result.waveform.slice(0, 2)).toEqual([0.5, 0.75]);
    });

    it('propagates an AudioEngine decode failure to the presentation boundary', async () => {
        const error = new Error('invalid impulse response');
        mocks.decodeAudioFileBuffer.mockRejectedValue(error);

        await expect(decodeImpulseResponse(makeFile())).rejects.toBe(error);
    });

    it('includes every frame in the waveform when the impulse response has fewer than 200 frames', async () => {
        mocks.decodeAudioFileBuffer.mockResolvedValue(makeMonoAudioBuffer([-0.25, 0.75, -0.5]));

        const result = await decodeImpulseResponse(makeFile());

        expect(result.waveform).toEqual([0.25, 0.75, 0.5]);
    });

    it('returns an empty waveform when the decoded impulse response has no frames', async () => {
        mocks.decodeAudioFileBuffer.mockResolvedValue(makeMonoAudioBuffer([]));

        const result = await decodeImpulseResponse(makeFile());

        expect(result.data).toHaveLength(0);
        expect(result.waveform).toEqual([]);
    });
});
