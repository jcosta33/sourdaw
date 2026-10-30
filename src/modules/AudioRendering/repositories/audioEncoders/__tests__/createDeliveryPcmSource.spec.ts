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

function countTrigonometry<T>(read: () => T) {
    const originalSin = Math.sin;
    const originalCos = Math.cos;
    let calls = 0;
    Math.sin = (value) => {
        calls++;
        return originalSin(value);
    };
    Math.cos = (value) => {
        calls++;
        return originalCos(value);
    };
    try {
        return { value: read(), calls };
    } finally {
        Math.sin = originalSin;
        Math.cos = originalCos;
    }
}

function referenceSample(input: {
    inputRate: number;
    outputRate: number;
    length: number;
    frame: number;
    sampleAt: (frame: number) => number;
}): number {
    const position = (input.frame * input.inputRate) / input.outputRate;
    const base = Math.floor(position);
    const cutoff = Math.min(1, input.outputRate / input.inputRate);
    let sum = 0;
    for (let tap = -63; tap <= 64; tap++) {
        const sourceFrame = base + tap;
        const sample = sourceFrame < 0 || sourceFrame >= input.length ? 0 : input.sampleAt(sourceFrame);
        const distance = sourceFrame - position;
        const scaledDistance = cutoff * distance;
        const sinc =
            Math.abs(scaledDistance) < 1e-12 ? 1 : Math.sin(Math.PI * scaledDistance) / (Math.PI * scaledDistance);
        const window =
            0.42 + 0.5 * Math.cos((Math.PI * distance) / 64) + 0.08 * Math.cos((2 * Math.PI * distance) / 64);
        sum += (Number.isFinite(sample) ? sample : 0) * cutoff * sinc * window;
    }
    return Math.fround(sum);
}

describe('delivery PCM source', () => {
    it.each([
        [48000, 44100],
        [44100, 96000],
    ])('reuses bounded exact phase weights across channels and replays for %i -> %i', (inputRate, outputRate) => {
        const input = Float32Array.from({ length: 10000 }, (_, frame) => ((frame % 127) - 63) / 64);
        const channelCalls = [];
        for (const channels of [1, 2]) {
            const converted = createDeliveryPcmSource({
                source: source(
                    inputRate,
                    Array.from({ length: channels }, () => input)
                ),
                sampleRate: outputRate,
                channels,
            });
            const whole = countTrigonometry(() => readExportPcmBlock({ source: converted, start: 0, length: 4096 }));
            // IEEE division gives several exact binary fractions per rational phase. Even with
            // those variants, the supported rates need far fewer kernels than output frames.
            expect(whole.calls).toBeLessThanOrEqual(320 * 8 * 128 * 3);
            const replay = countTrigonometry(() => readExportPcmBlock({ source: converted, start: 0, length: 4096 }));
            const split = countTrigonometry(() => {
                const a = readExportPcmBlock({ source: converted, start: 0, length: 2053 });
                const b = readExportPcmBlock({ source: converted, start: 2053, length: 2043 });
                return a.map((channel, index) => Float32Array.from([...channel, ...b[index]!]));
            });
            expect(replay.calls).toBe(0);
            expect(split.calls).toBe(0);
            expect(replay.value).toEqual(whole.value);
            expect(split.value).toEqual(whole.value);
            channelCalls.push(whole.calls);
        }
        expect(channelCalls[1]).toBe(channelCalls[0]);
        expect(input).toEqual(Float32Array.from({ length: 10000 }, (_, frame) => ((frame % 127) - 63) / 64));
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
        'preserves the original IEEE kernel at long indices and the padded tail for %i -> %i',
        (inputRate, outputRate) => {
            let length = Number.MAX_SAFE_INTEGER;
            if (inputRate < outputRate) {
                length = Math.floor(Number.MAX_SAFE_INTEGER / (outputRate / inputRate)) - 4096;
            }
            const sampleAt = (channel: number, frame: number) => {
                if (frame % 31 === 0) {
                    return Number.NaN;
                }
                return Math.fround(((((frame % 1021) + channel * 137) % 1021) - 510) / 512);
            };
            const converted = createDeliveryPcmSource({
                source: {
                    length,
                    sampleRate: inputRate,
                    numberOfChannels: 2,
                    readChannels: (start, count) =>
                        Array.from({ length: 2 }, (_, channel) =>
                            Float32Array.from({ length: count }, (_, frame) => sampleAt(channel, start + frame))
                        ),
                },
                sampleRate: outputRate,
                channels: 2,
            });
            for (const start of [0, 2 ** 32 + 37, converted.length - 8]) {
                const actual = readExportPcmBlock({ source: converted, start, length: 8 });
                for (let channel = 0; channel < 2; channel++) {
                    const expected = Float32Array.from({ length: 8 }, (_, frame) =>
                        referenceSample({
                            inputRate,
                            outputRate,
                            length,
                            frame: start + frame,
                            sampleAt: (sourceFrame) => sampleAt(channel, sourceFrame),
                        })
                    );
                    expect(actual[channel]).toEqual(expected);
                }
            }
        }
    );
    it('borrows valid unchanged rates and channel layouts before restricting conversions', () => {
        const original = source(
            32000,
            Array.from({ length: 3 }, () => new Float32Array([0.5]))
        );
        expect(createDeliveryPcmSource({ source: original, sampleRate: 32000, channels: 3 })).toBe(original);
        expect(() => createDeliveryPcmSource({ source: original, sampleRate: 44100, channels: 2 })).toThrow(
            'Unsupported delivery PCM conversion.'
        );
        expect(() =>
            createDeliveryPcmSource({ source: { ...original, length: -1 }, sampleRate: 32000, channels: 3 })
        ).toThrow('Invalid delivery PCM source.');
    });
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
