import { describe, expect, it, vi } from 'vitest';

import { createMono, createStereo, toAudioBufferMono, toAudioBufferStereo } from '../bufferCreation';

function createMockAudioContext() {
    const channelData: Float32Array[] = [];
    return {
        createBuffer: vi.fn((numberOfChannels: number, length: number, sampleRate: number) => {
            const channels: Float32Array[] = [];
            for (let c = 0; c < numberOfChannels; c += 1) {
                const ch = new Float32Array(length);
                channels.push(ch);
                channelData.push(ch);
            }
            return {
                length,
                sampleRate,
                numberOfChannels,
                duration: length / sampleRate,
                getChannelData: (index: number) => channels[index]!,
                copyFromChannel: vi.fn(),
                copyToChannel: vi.fn(),
            };
        }),
    };
}

describe('createMono', () => {
    it('creates a Float32Array of the correct length for the given duration', () => {
        const buf = createMono(0.5, 44100);

        expect(buf).toBeInstanceOf(Float32Array);
        // ceil(0.5 * 44100) = 22050.
        expect(buf.length).toBe(22050);
    });

    it('initializes all samples to zero', () => {
        const buf = createMono(0.01, 1000);

        for (let i = 0; i < buf.length; i += 1) {
            expect(buf[i]).toBe(0);
        }
    });

    it('always creates at least one sample even for zero duration', () => {
        const buf = createMono(0, 44100);

        expect(buf.length).toBe(1);
    });

    it('uses the default sample rate (44100) when none is passed', () => {
        const buf = createMono(1);

        // 1 second at 44100 Hz.
        expect(buf.length).toBe(44100);
    });
});

describe('createStereo', () => {
    it('returns two Float32Arrays of the correct length', () => {
        const [left, right] = createStereo(0.5, 44100);

        expect(left).toBeInstanceOf(Float32Array);
        expect(right).toBeInstanceOf(Float32Array);
        expect(left.length).toBe(22050);
        expect(right.length).toBe(22050);
    });

    it('both channels are independent (not the same reference)', () => {
        const [left, right] = createStereo(0.01, 1000);

        expect(left).not.toBe(right);
    });

    it('uses the default sample rate when none is passed', () => {
        const [left, right] = createStereo(1);

        expect(left.length).toBe(44100);
        expect(right.length).toBe(44100);
    });
});

describe('toAudioBufferMono', () => {
    it('creates a mono AudioBuffer and copies the source data into channel 0', () => {
        const ctx = createMockAudioContext();
        const data = new Float32Array([0.1, 0.2, 0.3]);

        const buf = toAudioBufferMono(ctx as never, data, 44100);

        expect(ctx.createBuffer).toHaveBeenCalledWith(1, 3, 44100);
        expect(buf.length).toBe(3);
        // Channel 0 should contain the source data.
        const ch0 = buf.getChannelData(0);
        expect(ch0[0]).toBeCloseTo(0.1, 5);
        expect(ch0[1]).toBeCloseTo(0.2, 5);
        expect(ch0[2]).toBeCloseTo(0.3, 5);
    });
});

describe('toAudioBufferStereo', () => {
    it('creates a stereo AudioBuffer and copies both channels', () => {
        const ctx = createMockAudioContext();
        const left = new Float32Array([0.5, 0.6]);
        const right = new Float32Array([0.7, 0.8]);

        const buf = toAudioBufferStereo(ctx as never, [left, right], 48000);

        expect(ctx.createBuffer).toHaveBeenCalledWith(2, 2, 48000);
        const ch0 = buf.getChannelData(0);
        const ch1 = buf.getChannelData(1);
        expect(ch0[0]).toBeCloseTo(0.5, 5);
        expect(ch0[1]).toBeCloseTo(0.6, 5);
        expect(ch1[0]).toBeCloseTo(0.7, 5);
        expect(ch1[1]).toBeCloseTo(0.8, 5);
    });
});
