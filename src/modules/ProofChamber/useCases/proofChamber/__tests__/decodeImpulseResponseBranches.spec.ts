import { describe, it, expect, vi, beforeEach } from 'vitest';

import { decodeAudioFileBuffer } from '#/modules/AudioEngine/useCases';

import { decodeImpulseResponse } from '../decodeImpulseResponse';

/**
 * decodeImpulseResponse imports decodeAudioFileBuffer from the AudioEngine
 * contract barrel. Mock it to return a fake AudioBuffer with controllable
 * channel data, then exercise the interleaving, downsampling, and peak-finding
 * branches.
 */

vi.mock('#/modules/AudioEngine/useCases', () => ({
    decodeAudioFileBuffer: vi.fn(),
}));

const mockedDecode = vi.mocked(decodeAudioFileBuffer);

function makeFakeAudioBuffer(channels: Float32Array[], sampleRate = 48_000): AudioBuffer {
    return {
        numberOfChannels: channels.length,
        length: channels[0]!.length,
        sampleRate,
        duration: channels[0]!.length / sampleRate,
        getChannelData: (channel: number) => channels[channel] ?? new Float32Array(0),
        copyFromChannel: () => {},
        copyToChannel: () => {},
    } as unknown as AudioBuffer;
}

beforeEach(() => {
    mockedDecode.mockReset();
});

describe('decodeImpulseResponse — channel interleaving', () => {
    it('interleaves stereo channels into a single Float32Array', async () => {
        const left = new Float32Array([0.1, 0.2, 0.3]);
        const right = new Float32Array([-0.1, -0.2, -0.3]);
        mockedDecode.mockResolvedValue(makeFakeAudioBuffer([left, right]));

        const result = await decodeImpulseResponse(new File([], 'ir.wav'));

        // Interleaved: [L0, R0, L1, R1, L2, R2]
        const expected = [0.1, -0.1, 0.2, -0.2, 0.3, -0.3];
        expect(result.data.length).toBe(6);
        for (let i = 0; i < 6; i++) {
            expect(result.data[i]).toBeCloseTo(expected[i]!, 5);
        }
        expect(result.channels).toBe(2);
    });

    it('pads a shorter channel with zeros (?? 0 fallback)', async () => {
        const ch0 = new Float32Array([0.5, 0.6, 0.7]);
        const ch1 = new Float32Array([0.1]); // shorter than ch0
        mockedDecode.mockResolvedValue(makeFakeAudioBuffer([ch0, ch1]));

        const result = await decodeImpulseResponse(new File([], 'ir.wav'));

        // ch1 only has index 0; indices 1 and 2 fall back to 0.
        // data[0*2+0]=0.5, data[0*2+1]=0.1, data[1*2+0]=0.6, data[1*2+1]=0, data[2*2+0]=0.7, data[2*2+1]=0
        const expected = [0.5, 0.1, 0.6, 0, 0.7, 0];
        expect(result.data.length).toBe(6);
        for (let i = 0; i < 6; i++) {
            expect(result.data[i]).toBeCloseTo(expected[i]!, 5);
        }
    });

    it('handles a mono buffer (1 channel)', async () => {
        const mono = new Float32Array([1, -1, 0.5, -0.5]);
        mockedDecode.mockResolvedValue(makeFakeAudioBuffer([mono]));

        const result = await decodeImpulseResponse(new File([], 'ir.wav'));

        expect(result.channels).toBe(1);
        expect(Array.from(result.data)).toEqual([1, -1, 0.5, -0.5]);
    });
});

describe('decodeImpulseResponse — waveform downsampling', () => {
    it('produces exactly 200 waveform points for a buffer with >= 200 frames', async () => {
        const mono = new Float32Array(450).fill(0.3);
        mockedDecode.mockResolvedValue(makeFakeAudioBuffer([mono]));

        const result = await decodeImpulseResponse(new File([], 'ir.wav'));

        expect(result.waveform).toHaveLength(200);
    });

    it('produces fewer points for a short buffer (< 200 frames)', async () => {
        const mono = new Float32Array(50).fill(0.5);
        mockedDecode.mockResolvedValue(makeFakeAudioBuffer([mono]));

        const result = await decodeImpulseResponse(new File([], 'ir.wav'));

        expect(result.waveform).toHaveLength(50);
    });

    it('the last bucket absorbs the remainder (integer division truncation)', async () => {
        // 450 frames, 200 points → samplesPerPoint = floor(450/200) = 2.
        // Points 0..198 cover 2 samples each (398 samples). Point 199 (last)
        // covers from 398 to mono.length=450 = 52 samples.
        const mono = new Float32Array(450).fill(0.1);
        // Put a large spike in the last bucket's range (sample 420).
        mono[420] = 0.99;
        mockedDecode.mockResolvedValue(makeFakeAudioBuffer([mono]));

        const result = await decodeImpulseResponse(new File([], 'ir.wav'));

        // The last waveform point should capture the spike at sample 420.
        expect(result.waveform[199]).toBeCloseTo(0.99, 5);
        // Earlier points should not see the spike.
        expect(result.waveform[100]).toBeCloseTo(0.1, 5);
    });

    it('finds the maximum absolute value within each bucket', async () => {
        // 4 frames, 4 points (samplesPerPoint = 1).
        const mono = new Float32Array([0.1, -0.5, 0.3, -0.7]);
        mockedDecode.mockResolvedValue(makeFakeAudioBuffer([mono]));

        const result = await decodeImpulseResponse(new File([], 'ir.wav'));

        // Each bucket is 1 sample; peaks are abs values.
        const expected = [0.1, 0.5, 0.3, 0.7];
        expect(result.waveform.length).toBe(4);
        for (let i = 0; i < 4; i++) {
            expect(result.waveform[i]).toBeCloseTo(expected[i]!, 5);
        }
    });

    it('handles an empty buffer without dividing by zero', async () => {
        const mono = new Float32Array(0);
        mockedDecode.mockResolvedValue(makeFakeAudioBuffer([mono]));

        const result = await decodeImpulseResponse(new File([], 'ir.wav'));

        expect(result.waveform).toEqual([]);
        expect(result.data.length).toBe(0);
    });
});

describe('decodeImpulseResponse — sample rate passthrough', () => {
    it('returns the AudioBuffer sample rate', async () => {
        const mono = new Float32Array([0.1]);
        mockedDecode.mockResolvedValue(makeFakeAudioBuffer([mono], 96_000));

        const result = await decodeImpulseResponse(new File([], 'ir.wav'));

        expect(result.sampleRate).toBe(96_000);
    });
});

describe('decodeImpulseResponse — mono channel selection', () => {
    it('uses channel 0 for the waveform regardless of channel count', async () => {
        // Channel 0 has small values; channel 1 has large values.
        // The waveform should reflect channel 0, not channel 1.
        const ch0 = new Float32Array([0.1, 0.1, 0.1, 0.1]);
        const ch1 = new Float32Array([0.9, 0.9, 0.9, 0.9]);
        mockedDecode.mockResolvedValue(makeFakeAudioBuffer([ch0, ch1]));

        const result = await decodeImpulseResponse(new File([], 'ir.wav'));

        // Waveform peaks should be 0.1 (from channel 0), not 0.9.
        for (const peak of result.waveform) {
            expect(peak).toBeCloseTo(0.1, 5);
        }
    });
});
