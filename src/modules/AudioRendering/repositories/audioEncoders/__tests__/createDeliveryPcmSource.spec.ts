import { describe, expect, it } from 'vitest';

import { createDeliveryPcmSource } from '../createDeliveryPcmSource';
import { readExportPcmBlock } from '../readExportPcmBlock';

function source(rate: number, channels: Float32Array[]) {
    return {
        length: channels[0]!.length,
        numberOfChannels: channels.length,
        sampleRate: rate,
        getChannelData: (channel: number) => channels[channel]!,
    };
}

describe('delivery PCM source', () => {
    it('refuses malformed spans directly at the replayable provider boundary', () => {
        const converted = createDeliveryPcmSource({
            source: source(48000, [new Float32Array(100)]),
            sampleRate: 44100,
            channels: 1,
        });
        const read = converted.readChannels;
        if (!read) {
            throw new Error('Expected converted PCM provider');
        }
        for (const start of [Number.NaN, Number.POSITIVE_INFINITY, 0.5, -1, Number.MAX_SAFE_INTEGER]) {
            expect(() => read(start, 1)).toThrow(/window/i);
        }
        expect(() => read(0, Number.NaN)).toThrow(/window/i);
        expect(() => read(0, 0.5)).toThrow(/window/i);
    });
    it('borrows unchanged PCM and performs the actual mono average and stereo duplication', () => {
        const left = new Float32Array([1, 0.5, -0.25]);
        const right = new Float32Array([-1, 0.25, 0.75]);
        const original = source(48000, [left, right]);
        expect(createDeliveryPcmSource({ source: original, sampleRate: 48000, channels: 2 })).toBe(original);
        const mono = createDeliveryPcmSource({ source: original, sampleRate: 48000, channels: 1 });
        const mixed = readExportPcmBlock({ source: mono, start: 0, length: 3 })[0]!;
        expect(Array.from(mixed)).toEqual([0, 0.375, 0.25]);
        const stereo = createDeliveryPcmSource({ source: source(48000, [mixed]), sampleRate: 48000, channels: 2 });
        expect(readExportPcmBlock({ source: stereo, start: 0, length: 3 }).map((c) => Array.from(c))).toEqual([
            [0, 0.375, 0.25],
            [0, 0.375, 0.25],
        ]);
        expect(Array.from(left)).toEqual([1, 0.5, -0.25]);
    });
    it.each([
        [44100, 48000],
        [48000, 44100],
        [96000, 44100],
        [44100, 96000],
        [88200, 48000],
        [48000, 88200],
        [88200, 96000],
        [96000, 88200],
        [44100, 88200],
        [88200, 44100],
        [48000, 96000],
        [96000, 48000],
    ])(
        'preserves analytic low-band gain/phase, frame count and block continuity for %i -> %i',
        (inputRate, outputRate) => {
            const length = inputRate;
            const input = Float32Array.from(
                { length },
                (_, frame) => 0.25 * Math.sin((2 * Math.PI * 1000 * frame) / inputRate)
            );
            const converted = createDeliveryPcmSource({
                source: source(inputRate, [input]),
                sampleRate: outputRate,
                channels: 1,
            });
            expect(converted.length).toBe(Math.round((length * outputRate) / inputRate));
            let squaredError = 0;
            let squaredSignal = 0;
            for (let start = 256; start < converted.length - 256; start += 997) {
                const count = Math.min(997, converted.length - 256 - start);
                const [block] = readExportPcmBlock({ source: converted, start, length: count });
                const split = Math.floor(count / 2);
                const a = readExportPcmBlock({ source: converted, start, length: split })[0]!;
                const b = readExportPcmBlock({ source: converted, start: start + split, length: count - split })[0]!;
                expect([...a, ...b]).toEqual(Array.from(block!));
                for (let frame = 0; frame < count; frame++) {
                    const expected = 0.25 * Math.sin((2 * Math.PI * 1000 * (start + frame)) / outputRate);
                    squaredError += (block![frame]! - expected) ** 2;
                    squaredSignal += expected ** 2;
                }
            }
            expect(10 * Math.log10(squaredError / squaredSignal)).toBeLessThan(-60);
        }
    );
    it('keeps the passband within0.1dB and rejects aliases by60dB away from transition', () => {
        for (const hz of [1000, 10000, 17640, 30000]) {
            const input = Float32Array.from(
                { length: 96000 },
                (_, frame) => 0.5 * Math.sin((2 * Math.PI * hz * frame) / 96000)
            );
            const converted = createDeliveryPcmSource({
                source: source(96000, [input]),
                sampleRate: 44100,
                channels: 1,
            });
            let power = 0;
            let count = 0;
            for (let start = 256; start < converted.length - 256; start += 4096) {
                const n = Math.min(4096, converted.length - 256 - start);
                for (const sample of readExportPcmBlock({ source: converted, start, length: n })[0]!) {
                    power += sample * sample;
                    count++;
                }
            }
            const gainDb = 10 * Math.log10(power / count / (0.5 ** 2 / 2));
            if (hz < 20000) {
                expect(Math.abs(gainDb)).toBeLessThanOrEqual(0.1);
            } else {
                expect(gainDb).toBeLessThanOrEqual(-60);
            }
        }
    });
    it('uses zero padded edges and refuses unbounded converted read requests', () => {
        const original = source(48000, [new Float32Array([1, 0, 0])]);
        const converted = createDeliveryPcmSource({ source: original, sampleRate: 44100, channels: 1 });
        const values = readExportPcmBlock({ source: converted, start: 0, length: converted.length })[0]!;
        expect(values.every(Number.isFinite)).toBe(true);
        expect(() => readExportPcmBlock({ source: { ...converted, length: 8192 }, start: 0, length: 8192 })).toThrow();
    });
});
