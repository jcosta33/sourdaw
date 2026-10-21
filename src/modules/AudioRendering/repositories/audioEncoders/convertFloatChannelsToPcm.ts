import { createPcmBlockReader } from './createPcmBlockReader';

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

/** Legacy collected conversion shares the streaming quantizer and its seeded channel order. */
export function convertFloatChannelsToPcm(input: ConvertFloatChannelsToPcmInput): ConvertFloatChannelsToPcmOutput {
    const reader = createPcmBlockReader({
        source: { length: input.length, numberOfChannels: input.channels.length, sampleRate: 44100,
            getChannelData: (channel) => input.channels[channel]! },
        bitDepth: input.bitDepth, dither: input.dither,
    });
    const block = reader.read(Math.max(1, input.length));
    if (input.bitDepth === 32) {
        const channels = block.channels.map((channel) => {
            if (!(channel instanceof Float32Array)) throw new Error('Expected float PCM.');
            return channel;
        });
        return { encoding: 'float32', bitDepth: 32, channels, gain: reader.gain, peak: reader.peak };
    }
    const channels = block.channels.map((channel) => {
        if (!(channel instanceof Int32Array)) throw new Error('Expected integer PCM.');
        return channel;
    });
    return { encoding: 'int', bitDepth: input.bitDepth, channels, gain: reader.gain, peak: reader.peak };
}
