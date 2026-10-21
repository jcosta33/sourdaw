import { describe, expect, it } from 'vitest';

import { createPcmBlockReader } from '../createPcmBlockReader';

/** Independent legacy channel-major sequence, pinned before the streaming transformation. */
function legacySeeded(channels: Float32Array[], depth: 16 | 24, seed: number) {
    let state = seed >>> 0;
    const uniform = () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let value = state;
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / 0x100000000;
    };
    const negative = 2 ** (depth - 1),
        positive = negative - 1;
    return channels.map((channel) =>
        Int32Array.from(channel, (sample) => {
            const scaled = sample < 0 ? sample * negative : sample * positive;
            return Math.max(-negative, Math.min(positive, Math.round(scaled + uniform() - uniform())));
        })
    );
}
describe('bounded PCM reader', () => {
    it('keeps the exact legacy seeded channel order across 1152/4096-frame boundaries', () => {
        const length = 4096 * 5 + 73;
        const channels = [0, 1].map((channel) =>
            Float32Array.from({ length }, (_, frame) => 0.4 * Math.sin(frame / (7 + channel)))
        );
        for (const depth of [16, 24] as const) {
            const expected = legacySeeded(channels, depth, 0x50f71a11);
            for (const size of [1152, 4096]) {
                const actual = [new Int32Array(length), new Int32Array(length)];
                const reader = createPcmBlockReader({
                    source: {
                        length,
                        numberOfChannels: 2,
                        sampleRate: 44100,
                        getChannelData: (channel) => channels[channel]!,
                    },
                    bitDepth: depth,
                    dither: { mode: 'tpdf', seed: 0x50f71a11 },
                });
                for (let frame = 0; frame < length; frame += size) {
                    const block = reader.read(size);
                    block.channels.forEach((channel, index) => actual[index]!.set(channel, block.start));
                }
                expect(actual).toEqual(expected);
            }
        }
    });
});

describe('replayable PCM reader', () => {
    it('reuses a measured peak and never asks for a complete target channel', () => {
        const requests: number[] = [];
        const reader = createPcmBlockReader({
            source: {
                length: 96000,
                sampleRate: 48000,
                numberOfChannels: 1,
                samplePeak: 0.5,
                gain: 0.5,
                readChannels: (_start, length) => {
                    requests.push(length);
                    return [new Float32Array(length).fill(0.5)];
                },
            },
            bitDepth: 16,
            dither: { mode: 'none' },
        });
        expect(requests).toEqual([]);
        const block = reader.read(1152);
        expect(requests).toEqual([1152]);
        expect(block.channels[0]![0]).toBe(Math.round(0.25 * 32767));
    });
});
