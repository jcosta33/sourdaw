import { describe, expect, it } from 'vitest';

import { audioBufferToWav } from '../../../repositories/audioEncoders/wavEncoder';
import { REPRODUCIBLE_DITHER_SEED, resolveExportDither } from '../resolveExportDither';

const SAMPLE_RATE = 48_000;
const FRAMES = 2048;

/**
 * Quiet, non-trivial signal. Dither only shows up in the low bits, so the
 * material has to sit well below full scale for 16-bit quantization to differ
 * run to run.
 */
function createQuietBuffer(): AudioBuffer {
    const channel = new Float32Array(FRAMES);
    for (let index = 0; index < FRAMES; index++) {
        channel[index] = Math.sin((2 * Math.PI * 440 * index) / SAMPLE_RATE) * 0.002;
    }

    return {
        numberOfChannels: 1,
        length: FRAMES,
        sampleRate: SAMPLE_RATE,
        duration: FRAMES / SAMPLE_RATE,
        getChannelData: () => channel,
    } as unknown as AudioBuffer;
}

async function encode16Bit(dither: ReturnType<typeof resolveExportDither>): Promise<Uint8Array> {
    return new Uint8Array(await audioBufferToWav(createQuietBuffer(), 16, undefined, dither));
}

describe('resolveExportDither', () => {
    it('keeps unseeded TPDF dither for the default preference', () => {
        expect(resolveExportDither('random')).toEqual({ mode: 'tpdf' });
    });

    it('supplies a stable seed for reproducible exports', () => {
        expect(resolveExportDither('seeded')).toEqual({ mode: 'tpdf', seed: REPRODUCIBLE_DITHER_SEED });
    });

    it('turns dither off for a bit-exact bounce', () => {
        expect(resolveExportDither('none')).toEqual({ mode: 'none' });
    });
});

describe('export dither — reproducibility of the encoded bytes', () => {
    it('produces byte-identical 16-bit WAVs across two seeded exports', async () => {
        const first = await encode16Bit(resolveExportDither('seeded'));
        const second = await encode16Bit(resolveExportDither('seeded'));

        expect(Array.from(second)).toEqual(Array.from(first));
    });

    it('produces byte-identical 16-bit WAVs when dither is off', async () => {
        const first = await encode16Bit(resolveExportDither('none'));
        const second = await encode16Bit(resolveExportDither('none'));

        expect(Array.from(second)).toEqual(Array.from(first));
    });

    it('still varies between two unseeded exports, which is what made re-delivery irreproducible', async () => {
        const first = await encode16Bit(resolveExportDither('random'));
        const second = await encode16Bit(resolveExportDither('random'));

        expect(Array.from(second)).not.toEqual(Array.from(first));
    });

    it('keeps the seeded bytes distinct from the undithered ones', async () => {
        // Guards against a seeded path that silently degrades to "no dither":
        // both are reproducible, so equality checks alone would not notice.
        const seeded = await encode16Bit(resolveExportDither('seeded'));
        const undithered = await encode16Bit(resolveExportDither('none'));

        expect(Array.from(seeded)).not.toEqual(Array.from(undithered));
    });
});
