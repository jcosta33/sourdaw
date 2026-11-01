import { describe, expect, it, vi } from 'vitest';

import { createMono, createStereo, monoPcm, stereoPcm, toAudioBuffer } from '../bufferCreation';

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

describe('monoPcm and stereoPcm', () => {
    it('wrap rendered data as channels at the factory sample rate without copying', () => {
        const mono = new Float32Array([0.1]);
        const left = new Float32Array([0.5]);
        const right = new Float32Array([0.7]);

        expect(monoPcm(mono)).toEqual({ channels: [mono], sampleRate: 44100 });
        expect(monoPcm(mono).channels[0]).toBe(mono);
        const stereo = stereoPcm([left, right]);
        expect(stereo.sampleRate).toBe(44100);
        expect(stereo.channels[0]).toBe(left);
        expect(stereo.channels[1]).toBe(right);
    });
});

describe('toAudioBuffer', () => {
    it('creates a mono AudioBuffer and copies the source data into channel 0', () => {
        const ctx = createMockAudioContext();
        const data = new Float32Array([0.1, 0.2, 0.3]);

        const buf = toAudioBuffer(ctx as unknown as AudioContext, { channels: [data], sampleRate: 44100 });

        expect(ctx.createBuffer).toHaveBeenCalledWith(1, 3, 44100);
        expect(buf.length).toBe(3);
        expect(Array.from(buf.getChannelData(0))).toEqual(Array.from(data));
    });

    it('creates a stereo AudioBuffer and copies both channels', () => {
        const ctx = createMockAudioContext();
        const left = new Float32Array([0.5, 0.6]);
        const right = new Float32Array([0.7, 0.8]);

        const buf = toAudioBuffer(ctx as unknown as AudioContext, { channels: [left, right], sampleRate: 48000 });

        expect(ctx.createBuffer).toHaveBeenCalledWith(2, 2, 48000);
        expect(Array.from(buf.getChannelData(0))).toEqual(Array.from(left));
        expect(Array.from(buf.getChannelData(1))).toEqual(Array.from(right));
    });

    it('refuses a sample with no channels instead of creating an empty buffer', () => {
        const ctx = createMockAudioContext();

        expect(() => toAudioBuffer(ctx as unknown as AudioContext, { channels: [], sampleRate: 44100 })).toThrow();
        expect(ctx.createBuffer).not.toHaveBeenCalled();
    });
});
