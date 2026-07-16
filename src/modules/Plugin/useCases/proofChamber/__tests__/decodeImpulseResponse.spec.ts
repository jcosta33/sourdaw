import { beforeEach, describe, expect, it, vi } from 'vitest';

import { decodeImpulseResponse } from '../decodeImpulseResponse';

const mocks = vi.hoisted(() => ({
    decodeAudioData: vi.fn(),
    getAudioContext: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    getAudioContext: mocks.getAudioContext,
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

describe('decodeImpulseResponse', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getAudioContext.mockReturnValue({ decodeAudioData: mocks.decodeAudioData });
    });

    it('decodes through the shared AudioContext and returns interleaved data plus preview peaks', async () => {
        const file = makeFile();
        const arrayBuffer = new ArrayBuffer(4);
        vi.spyOn(file, 'arrayBuffer').mockResolvedValue(arrayBuffer);
        mocks.decodeAudioData.mockResolvedValue(makeAudioBuffer());

        const result = await decodeImpulseResponse(file);

        expect(mocks.getAudioContext).toHaveBeenCalledTimes(1);
        expect(mocks.decodeAudioData).toHaveBeenCalledWith(arrayBuffer);
        expect(result.channels).toBe(2);
        expect(result.sampleRate).toBe(48_000);
        expect(result.data.slice(0, 6)).toEqual(new Float32Array([0.25, -0.25, 0.5, -0.5, 0.75, 0]));
        expect(result.waveform).toHaveLength(200);
        expect(result.waveform.slice(0, 2)).toEqual([0.5, 0.75]);
    });

    it('propagates a shared AudioContext decode failure to the presentation boundary', async () => {
        const error = new Error('invalid impulse response');
        mocks.decodeAudioData.mockRejectedValue(error);

        await expect(decodeImpulseResponse(makeFile())).rejects.toBe(error);
    });
});
