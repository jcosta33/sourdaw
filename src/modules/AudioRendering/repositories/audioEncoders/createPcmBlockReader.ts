import { type ExportAudioSource } from '../../models/ExportAudioSource';

import { type PcmDitherOptions } from '../../models/PcmDitherOptions';

const STEP = 0x6d2b79f5;

function uniform(state: { value: number }): number {
    state.value = (state.value + STEP) >>> 0;
    let value = state.value;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x100000000;
}

function sanitize(value: number): number {
    if (Number.isFinite(value)) {
        return value;
    }
    if (value === Number.POSITIVE_INFINITY) {
        return 1;
    }
    if (value === Number.NEGATIVE_INFINITY) {
        return -1;
    }
    return 0;
}

/** Whole-window gain, then bounded channel-major TPDF. Recreating a reader replays a supplied seed. */
export function createPcmBlockReader(input: {
    source: ExportAudioSource;
    bitDepth: 16 | 24 | 32;
    dither?: PcmDitherOptions;
    channelLimit?: number;
}) {
    const { source, bitDepth, channelLimit = source.numberOfChannels } = input;
    const channelCount = Math.min(channelLimit, source.numberOfChannels);
    const channels = Array.from({ length: channelCount }, (_, channel) => source.getChannelData(channel));
    if (
        !Number.isSafeInteger(source.length) ||
        source.length < 0 ||
        channelCount < 1 ||
        channels.some((channel) => channel.length < source.length)
    ) {
        throw new Error('Invalid export PCM window.');
    }
    const sourceGain = source.gain ?? 1;
    if (!Number.isFinite(sourceGain) || sourceGain < 0) {
        throw new Error('Invalid export PCM gain.');
    }
    let peak = 0;
    for (const channel of channels) {
        for (let frame = 0; frame < source.length; frame++) {
            const value = Math.abs(channel[frame]! * sourceGain);
            if (Number.isFinite(value)) {
                peak = Math.max(peak, value);
            }
        }
    }
    const gain = peak > 1 ? 1 / peak : 1;
    const dither = input.dither ?? { mode: 'tpdf' };
    const seed = dither.seed ?? Math.floor(Math.random() * 0x100000000);
    // Multiplication is modulo 2^32; imul avoids losing low bits on long windows.
    const states = channels.map((_, channel) => ({
        value: (seed + Math.imul(Math.imul(2, source.length), Math.imul(channel, STEP))) >>> 0,
    }));
    let nextFrame = 0;
    return {
        gain,
        peak,
        seed,
        read(frameCount: number) {
            const length = Math.min(frameCount, source.length - nextFrame);
            if (!Number.isSafeInteger(frameCount) || frameCount < 1) {
                throw new Error('Invalid PCM block size.');
            }
            const start = nextFrame;
            nextFrame += length;
            const output = channels.map((channel, index) => {
                const values = bitDepth === 32 ? new Float32Array(length) : new Int32Array(length);
                const negativeScale = 2 ** (bitDepth - 1);
                const positiveScale = negativeScale - 1;
                for (let frame = 0; frame < length; frame++) {
                    const sample = sanitize(channel[start + frame]! * sourceGain * gain);
                    if (bitDepth === 32) {
                        values[frame] = sample;
                    } else {
                        const noise = dither.mode === 'none' ? 0 : uniform(states[index]!) - uniform(states[index]!);
                        const scaled = sample < 0 ? sample * negativeScale : sample * positiveScale;
                        values[frame] = Math.max(-negativeScale, Math.min(positiveScale, Math.round(scaled + noise)));
                    }
                }
                return values;
            });
            return { start, length, channels: output };
        },
    };
}
