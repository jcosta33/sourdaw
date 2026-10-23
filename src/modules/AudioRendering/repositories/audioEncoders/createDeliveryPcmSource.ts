import { type ExportAudioSource } from '../../models/ExportAudioSource';

import { readExportPcmBlock } from './readExportPcmBlock';

const MAX_BLOCK = 4096;
const TAPS = 128;
const HALF = TAPS / 2;

function finite(sample: number): number {
    return Number.isFinite(sample) ? sample : 0;
}
function sinc(value: number): number {
    return Math.abs(value) < 1e-12 ? 1 : Math.sin(Math.PI * value) / (Math.PI * value);
}

function createKernel(position: number, base: number, cutoff: number): Float64Array {
    const kernel = new Float64Array(TAPS * 2);
    for (let tap = -HALF + 1; tap <= HALF; tap++) {
        const distance = base + tap - position;
        const index = (tap + HALF - 1) * 2;
        kernel[index] = sinc(cutoff * distance);
        kernel[index + 1] =
            0.42 + 0.5 * Math.cos((Math.PI * distance) / HALF) + 0.08 * Math.cos((2 * Math.PI * distance) / HALF);
    }
    return kernel;
}

function createKernelCache(cutoff: number): (position: number, base: number) => Float64Array {
    // Absolute-position rounding gives multiple binary fractions per rational phase. Keep
    // those exact, retaining at most one bounded block's kernels across channels and replays.
    const kernels = new Map<number, Float64Array>();
    return (position, base) => {
        // Past this boundary base + tap can round away an integer, so phase alone cannot
        // identify the original distances. Preserve that admitted long-index behavior.
        if (base > Number.MAX_SAFE_INTEGER - HALF) {
            return createKernel(position, base, cutoff);
        }
        const phase = position - base;
        const cached = kernels.get(phase);
        if (cached) {
            return cached;
        }
        const kernel = createKernel(position, base, cutoff);
        if (kernels.size === MAX_BLOCK) {
            const oldest = kernels.keys().next().value;
            if (oldest !== undefined) {
                kernels.delete(oldest);
            }
        }
        kernels.set(phase, kernel);
        return kernel;
    };
}

function assertValidInput(source: ExportAudioSource, sampleRate: number): void {
    if (
        !Number.isSafeInteger(source.length) ||
        source.length < 0 ||
        !Number.isFinite(source.sampleRate) ||
        source.sampleRate <= 0 ||
        !Number.isFinite(sampleRate) ||
        sampleRate <= 0 ||
        !Number.isSafeInteger(source.numberOfChannels) ||
        source.numberOfChannels < 1
    ) {
        throw new Error('Invalid delivery PCM source.');
    }
}

function assertSupportedConversion(source: ExportAudioSource, sampleRate: number, channels: number): void {
    if (
        ![44100, 48000, 88200, 96000].includes(source.sampleRate) ||
        ![44100, 48000, 88200, 96000].includes(sampleRate) ||
        (source.numberOfChannels !== 1 && source.numberOfChannels !== 2) ||
        (channels !== 1 && channels !== 2)
    ) {
        throw new Error('Unsupported delivery PCM conversion.');
    }
}

/** Replayable target PCM. Absolute rational phase makes block partitioning immaterial. */
export function createDeliveryPcmSource(input: {
    source: ExportAudioSource;
    sampleRate: number;
    channels: number;
}): ExportAudioSource {
    const { source, sampleRate, channels } = input;
    assertValidInput(source, sampleRate);
    if (sampleRate === source.sampleRate && channels === source.numberOfChannels) {
        return source;
    }
    assertSupportedConversion(source, sampleRate, channels);
    const length = Math.round((source.length * sampleRate) / source.sampleRate);
    if (!Number.isSafeInteger(length)) {
        throw new TypeError('Delivery PCM exceeds the frame limit.');
    }
    const cutoff = Math.min(1, sampleRate / source.sampleRate);
    const kernelAt = createKernelCache(cutoff);
    return {
        length,
        numberOfChannels: channels,
        sampleRate,
        gain: source.gain,
        readChannels(start, count) {
            if (
                !Number.isSafeInteger(start) ||
                !Number.isSafeInteger(count) ||
                !Number.isSafeInteger(start + count) ||
                count < 0 ||
                count > MAX_BLOCK ||
                start < 0 ||
                start + count > length
            ) {
                throw new Error('Invalid bounded delivery PCM window.');
            }
            const output = Array.from({ length: channels }, () => new Float32Array(count));
            if (count === 0 || source.length === 0) {
                return output;
            }
            const sameRate = sampleRate === source.sampleRate;
            const first = sameRate ? start : Math.floor((start * source.sampleRate) / sampleRate) - HALF + 1;
            let last: number;
            if (sameRate) {
                last = start + count;
            } else {
                last = Math.floor(((start + count - 1) * source.sampleRate) / sampleRate) + HALF + 1;
            }
            // Downsampling at the admitted rates spans at most ~9k input frames. Read bounded
            // pages even when the upstream source is itself replayable, never a full channel.
            const boundedFirst = Math.max(0, first),
                boundedLast = Math.min(source.length, last);
            const pages: { start: number; channels: readonly Float32Array[] }[] = [];
            for (let frame = boundedFirst; frame < boundedLast; frame += MAX_BLOCK) {
                pages.push({
                    start: frame,
                    channels: readExportPcmBlock({
                        source,
                        start: frame,
                        length: Math.min(MAX_BLOCK, boundedLast - frame),
                    }),
                });
            }
            const sampleAt = (channel: number, frame: number): number => {
                if (frame < boundedFirst || frame >= boundedLast) {
                    return 0;
                }
                const page = pages[Math.floor((frame - boundedFirst) / MAX_BLOCK)]!;
                return finite(page.channels[channel]![frame - page.start]!);
            };
            const mixedAt = (channel: number, frame: number): number => {
                if (channels === 1 && source.numberOfChannels === 2) {
                    return (sampleAt(0, frame) + sampleAt(1, frame)) / 2;
                }
                return sampleAt(source.numberOfChannels === 1 ? 0 : channel, frame);
            };
            for (let frame = 0; frame < count; frame++) {
                const position = ((start + frame) * source.sampleRate) / sampleRate;
                const base = Math.floor(position);
                if (sameRate) {
                    for (let channel = 0; channel < channels; channel++) {
                        output[channel]![frame] = mixedAt(channel, base);
                    }
                    continue;
                }
                const kernel = kernelAt(position, base);
                for (let channel = 0; channel < channels; channel++) {
                    let sum = 0;
                    for (let tap = -HALF + 1; tap <= HALF; tap++) {
                        const index = (tap + HALF - 1) * 2;
                        // Keep the factors separate to preserve the PCM multiplication order.
                        sum += mixedAt(channel, base + tap) * cutoff * kernel[index]! * kernel[index + 1]!;
                    }
                    output[channel]![frame] = sum;
                }
            }
            return output;
        },
    };
}
