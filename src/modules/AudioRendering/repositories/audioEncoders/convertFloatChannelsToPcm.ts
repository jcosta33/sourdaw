/**
 * The single float→PCM stage every export encoder consumes (OE-1).
 *
 * Before this existed each encoder did its own conversion: WAV peak-normalized
 * and dithered at 16-bit, FLAC and MP3 hard-clipped with no dither, and the
 * three disagreed on rounding. The same mixdown therefore landed at a
 * different level depending on the container the user picked.
 *
 * The pipeline here is the golden-standard order — gain, then dither, then
 * quantize — and dither is applied exactly once, only when the float source is
 * actually reduced to a fixed bit depth. 32-bit float output is never dithered.
 */

/**
 * Dither control. `seed` makes the TPDF noise reproducible, so an export can be
 * compared byte-for-byte across formats and across runs; omit it for the
 * ordinary non-reproducible export path.
 */
export type PcmDitherOptions = {
    mode: 'tpdf' | 'none';
    seed?: number;
};

export type ConvertFloatChannelsToPcmInput = {
    channels: Float32Array[];
    length: number;
    bitDepth: 16 | 24 | 32;
    dither?: PcmDitherOptions;
};

export type ConvertFloatChannelsToPcmOutput =
    | {
          encoding: 'int';
          bitDepth: 16 | 24;
          channels: Int32Array[];
          gain: number;
          peak: number;
      }
    | {
          encoding: 'float32';
          bitDepth: 32;
          channels: Float32Array[];
          gain: number;
          peak: number;
      };

const DEFAULT_DITHER: PcmDitherOptions = { mode: 'tpdf' };

/**
 * Degrade a non-finite sample so it can never poison the file: ±Infinity
 * becomes full scale, NaN becomes silence. Finite samples pass through.
 */
function sanitizeSample(value: number): number {
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

/** mulberry32 — small, fast, fully determined by its 32-bit state. */
function createSeededUniform(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let value = state;
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / 0x100000000;
    };
}

/**
 * TPDF dither: the difference of two independent uniform draws is triangular
 * over ±1 LSB, which decorrelates quantization error without the noise
 * modulation a rectangular source leaves behind.
 */
function createDitherSource(dither: PcmDitherOptions): () => number {
    if (dither.mode === 'none') {
        return () => 0;
    }
    if (dither.seed === undefined) {
        return () => Math.random() - Math.random();
    }
    const uniform = createSeededUniform(dither.seed);
    return () => uniform() - uniform();
}

/**
 * Largest absolute FINITE sample across every channel. Non-finite samples are
 * excluded: one ±Infinity would otherwise make gain = 1/Infinity = 0 and
 * silently zero the whole export. They degrade per-sample via sanitizeSample.
 */
function findPeak(channels: Float32Array[], length: number): number {
    let peak = 0;
    for (const data of channels) {
        for (let index = 0; index < length; index++) {
            const abs = Math.abs(data[index]!);
            if (Number.isFinite(abs) && abs > peak) {
                peak = abs;
            }
        }
    }
    return peak;
}

function applyGain(channels: Float32Array[], length: number, gain: number): Float32Array[] {
    return channels.map((data) => {
        const out = new Float32Array(length);
        for (let index = 0; index < length; index++) {
            out[index] = sanitizeSample(data[index]! * gain);
        }
        return out;
    });
}

/**
 * Convert float channel data to the PCM representation an encoder writes.
 *
 * Channels are processed channel-outer / sample-inner, so a seeded dither draws
 * the same noise sequence in the same order for every encoder — that is what
 * makes cross-format parity assertable.
 */
export function convertFloatChannelsToPcm(input: ConvertFloatChannelsToPcmInput): ConvertFloatChannelsToPcmOutput {
    const { channels, length, bitDepth } = input;
    const dither = input.dither ?? DEFAULT_DITHER;

    // Only attenuate when the mix exceeds full scale; sub-full-scale material
    // keeps its authored level and is never boosted.
    const peak = findPeak(channels, length);
    const gain = peak > 1 ? 1 / peak : 1;

    if (bitDepth === 32) {
        // Float output is not a bit-depth reduction — dithering it would only
        // add noise to a full-resolution file.
        return { encoding: 'float32', bitDepth: 32, channels: applyGain(channels, length, gain), gain, peak };
    }

    const negativeScale = 2 ** (bitDepth - 1);
    const positiveScale = negativeScale - 1;
    const noise = createDitherSource(dither);

    const quantized = channels.map((data) => {
        const out = new Int32Array(length);
        for (let index = 0; index < length; index++) {
            const sample = sanitizeSample(data[index]! * gain);
            const scaled = sample < 0 ? sample * negativeScale : sample * positiveScale;
            const rounded = Math.round(scaled + noise());
            out[index] = Math.max(-negativeScale, Math.min(positiveScale, rounded));
        }
        return out;
    });

    return { encoding: 'int', bitDepth, channels: quantized, gain, peak };
}
