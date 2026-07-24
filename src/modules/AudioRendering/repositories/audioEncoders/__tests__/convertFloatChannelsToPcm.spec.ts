import { describe, it, expect } from 'vitest';

import { convertFloatChannelsToPcm } from '../convertFloatChannelsToPcm';

function channelOf(values: number[]): Float32Array {
    return Float32Array.from(values);
}

describe('convertFloatChannelsToPcm', () => {
    it('should attenuate an over-full-scale mix by 1/peak instead of clipping it', () => {
        const result = convertFloatChannelsToPcm({
            channels: [channelOf([2, -2, 1])],
            length: 3,
            bitDepth: 16,
            dither: { mode: 'none' },
        });

        expect(result.gain).toBeCloseTo(0.5, 10);
        expect(result.peak).toBe(2);
        // The 2.0 peak lands exactly at full scale, and the 1.0 sample keeps
        // its relative level at half scale — a hard clamp would flatten both.
        expect(Array.from(result.channels[0]!)).toEqual([0x7fff, -0x8000, Math.round(0x7fff * 0.5)]);
    });

    it('should leave a sub-full-scale mix at its authored level', () => {
        const result = convertFloatChannelsToPcm({
            channels: [channelOf([0.5, -0.5])],
            length: 2,
            bitDepth: 16,
            dither: { mode: 'none' },
        });

        expect(result.gain).toBe(1);
        expect(Array.from(result.channels[0]!)).toEqual([Math.round(0x7fff * 0.5), -0x4000]);
    });

    it('should quantize to the requested bit depth', () => {
        const twentyFour = convertFloatChannelsToPcm({
            channels: [channelOf([1, -1])],
            length: 2,
            bitDepth: 24,
            dither: { mode: 'none' },
        });

        expect(Array.from(twentyFour.channels[0]!)).toEqual([0x7fffff, -0x800000]);
    });

    it('should produce identical samples for the same dither seed and different samples for another', () => {
        const source = [channelOf([0.1, -0.2, 0.3, -0.4])];
        function convert(seed: number): number[] {
            const result = convertFloatChannelsToPcm({
                channels: source,
                length: 4,
                bitDepth: 16,
                dither: { mode: 'tpdf', seed },
            });
            return Array.from(result.channels[0]!);
        }

        expect(convert(42)).toEqual(convert(42));
        expect(convert(42)).not.toEqual(convert(43));
    });

    it('should keep seeded dither within one LSB of the undithered quantization', () => {
        const source = [channelOf([0.1, -0.2, 0.3, -0.4])];
        const plain = convertFloatChannelsToPcm({
            channels: source,
            length: 4,
            bitDepth: 16,
            dither: { mode: 'none' },
        });
        const dithered = convertFloatChannelsToPcm({
            channels: source,
            length: 4,
            bitDepth: 16,
            dither: { mode: 'tpdf', seed: 5 },
        });

        for (let index = 0; index < 4; index++) {
            expect(Math.abs(dithered.channels[0]![index]! - plain.channels[0]![index]!)).toBeLessThanOrEqual(1);
        }
    });

    it('should not dither 32-bit float output', () => {
        const source = [channelOf([0.25, -0.25])];
        const first = convertFloatChannelsToPcm({
            channels: source,
            length: 2,
            bitDepth: 32,
            dither: { mode: 'tpdf', seed: 1 },
        });
        const second = convertFloatChannelsToPcm({
            channels: source,
            length: 2,
            bitDepth: 32,
            dither: { mode: 'tpdf', seed: 2 },
        });

        expect(first.encoding).toBe('float32');
        expect(Array.from(first.channels[0]!)).toEqual([0.25, -0.25]);
        expect(Array.from(second.channels[0]!)).toEqual(Array.from(first.channels[0]!));
    });

    it('should degrade non-finite samples instead of zeroing the whole render', () => {
        const result = convertFloatChannelsToPcm({
            channels: [channelOf([Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NaN, 0.5])],
            length: 4,
            bitDepth: 16,
            dither: { mode: 'none' },
        });

        expect(result.gain).toBe(1);
        expect(Array.from(result.channels[0]!)).toEqual([0x7fff, -0x8000, 0, Math.round(0x7fff * 0.5)]);
    });
});
