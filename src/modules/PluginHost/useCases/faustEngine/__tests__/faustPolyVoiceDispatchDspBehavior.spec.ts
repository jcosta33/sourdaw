// @vitest-environment node
import { readFileSync } from 'node:fs';

// The package's "main" CJS bundle exposes no runtime exports under Node SSR
// resolution; the ESM build (what Vite serves the app) does.
import {
    FaustPolyDspGenerator,
    type FaustPolyDspGenerator as FaustPolyDspGeneratorType,
    type IFaustCompiler,
    type IFaustPolyOfflineProcessor,
} from '@grame/faustwasm/dist/esm/index.js';
import { beforeAll, describe, expect, it } from 'vitest';

import { loadFaustCompilerForSpec } from '../../../testing/loadFaustCompilerForSpec';

/**
 * Audio oracle for Faust polyphonic voice dispatch (#3721).
 *
 * Rhodes and FM Synth compile through `FaustPolyDspGenerator` (see
 * `compileFaustDSP.ts`), whose processor only computes voices that `keyOn`
 * allocated — free voices are skipped entirely, so plain freq/gain/gate
 * parameter writes reach no voice and render silence. Timeline scheduling and
 * piano-roll audition used exactly those parameter writes
 * (`scheduleFaustNote`/`startFaustNote`), while the offline render already
 * voiced through `keyOn`/`keyOff` (`FaustDeviceStrategy.noteOn/noteOff` →
 * `wamControls.keyOn/keyOff` → `node.keyOn`).
 *
 * These tests exercise that same `keyOn`/`keyOff` surface — the vendor maps
 * pitch through `440 * 2^((pitch-69)/12)` and velocity through `velocity/127`
 * — on the shipped rhodes.dsp/fm-synth.dsp sources, compiled with the app's
 * own compiler path, at the same voice count `createFaustNode` uses (8):
 *
 * - parameter-only writes on a fresh poly processor stay silent (the defect,
 *   and what reverting the scheduler to `scheduleDeviceParam` would restore);
 * - keyOn emits nonzero PCM;
 * - overlapping keyOns allocate distinct voices (a chord keeps both notes);
 * - keyOff releases only its own note.
 *
 * The dispatch wiring from timeline/audition into this surface is pinned by
 * `src/modules/AudioEngine/useCases/faustScheduler/__tests__/`.
 */

const DSP_DIR = 'src/modules/PluginHost/useCases/faustEngine/dsp';
const COMPILE_TIMEOUT_MS = 240_000;

const SAMPLE_RATE = 48_000;
const BLOCK_SIZE = 512;
/** `POLY_VOICES_DEFAULT` in createFaustNode.ts. */
const VOICES = 8;

/** Rhodes ADSR: body release 0.3 s, bell release 0.1 s — past both after 0.7 s. */
const RELEASE_SETTLE_BLOCKS = Math.floor((0.7 * SAMPLE_RATE) / BLOCK_SIZE);

const PITCH_A4 = 69;
const PITCH_C5 = 72;
const FREQ_A4 = 440;
const FREQ_C5 = 440 * 2 ** ((PITCH_C5 - PITCH_A4) / 12);

type UiItem = {
    items?: UiItem[];
    address?: string;
};

const rhodesAddresses = new Map<string, string>();

function extractAddresses(items: UiItem[]): void {
    for (const item of items) {
        if (item.items) {
            extractAddresses(item.items);
        } else if (item.address) {
            const bare = item.address.split('/').pop();
            if (bare) {
                rhodesAddresses.set(bare, item.address);
            }
        }
    }
}

async function freshProcessor(generator: FaustPolyDspGeneratorType): Promise<IFaustPolyOfflineProcessor> {
    const processor = await generator.createOfflineProcessor(SAMPLE_RATE, BLOCK_SIZE, VOICES);
    processor.start();
    return processor;
}

/** Instruments have no audio inputs; compute `blocks` and return output channel 0. */
function renderBlocks(processor: IFaustPolyOfflineProcessor, blocks: number): Float32Array {
    const outputs = Array.from({ length: processor.getNumOutputs() }, () => new Float32Array(BLOCK_SIZE));
    const acc = new Float32Array(blocks * BLOCK_SIZE);
    for (let b = 0; b < blocks; b++) {
        processor.compute([], outputs);
        for (let i = 0; i < BLOCK_SIZE; i++) {
            acc[b * BLOCK_SIZE + i] = outputs[0]?.[i] ?? 0;
        }
    }
    return acc;
}

function peakAbs(signal: Float32Array): number {
    let peak = 0;
    for (const sample of signal) {
        peak = Math.max(peak, Math.abs(sample));
    }
    return peak;
}

/** Goertzel magnitude of `frequency` over samples [from, to). */
function sinusoidalAmplitude(signal: Float32Array, frequency: number, fromSample: number, toSample: number): number {
    const nSamples = toSample - fromSample;
    if (nSamples <= 0) {
        return 0;
    }
    let re = 0;
    let im = 0;
    const omega = (2 * Math.PI * frequency) / SAMPLE_RATE;
    for (let n = fromSample; n < toSample; n++) {
        const x = signal[n] ?? 0;
        re += x * Math.cos(omega * n);
        im += x * Math.sin(omega * n);
    }
    return Math.hypot((2 / nSamples) * re, (2 / nSamples) * im);
}

describe('Faust poly instruments voice timeline/audition keyOn dispatch (#3721)', () => {
    let rhodes: FaustPolyDspGeneratorType;
    let fmSynth: FaustPolyDspGeneratorType;

    beforeAll(async () => {
        const compiler: IFaustCompiler = await loadFaustCompilerForSpec();

        const rhodesCode = readFileSync(`${DSP_DIR}/rhodes.dsp`, 'utf8');
        const rhodesGenerator = new FaustPolyDspGenerator();
        if (!(await rhodesGenerator.compile(compiler, 'Rhodes', rhodesCode, '-I libraries/'))) {
            throw new Error('rhodes.dsp must compile as a poly instrument');
        }
        rhodes = rhodesGenerator;
        const rhodesJson = JSON.parse(rhodes.getJSON()) as { ui?: UiItem[] };
        extractAddresses(rhodesJson.ui ?? []);

        const fmCode = readFileSync(`${DSP_DIR}/fm-synth.dsp`, 'utf8');
        const fmGenerator = new FaustPolyDspGenerator();
        if (!(await fmGenerator.compile(compiler, 'FM_Synth', fmCode, '-I libraries/'))) {
            throw new Error('fm-synth.dsp must compile as a poly instrument');
        }
        fmSynth = fmGenerator;
    }, COMPILE_TIMEOUT_MS);

    it('parameter-only freq/gain/gate writes leave a fresh poly processor silent', async () => {
        // The old live dispatch: write the note as device parameters. The poly
        // compute loop skips free voices, so no voice ever plays.
        const processor = await freshProcessor(rhodes);
        processor.setParamValue(rhodesAddresses.get('freq') ?? 'freq', 440);
        processor.setParamValue(rhodesAddresses.get('gain') ?? 'gain', 1);
        processor.setParamValue(rhodesAddresses.get('gate') ?? 'gate', 1);

        expect(peakAbs(renderBlocks(processor, 48))).toBe(0);
    });

    it('keyOn dispatch voices the note with nonzero PCM', async () => {
        const processor = await freshProcessor(rhodes);
        processor.keyOn(0, PITCH_A4, 127);

        // Measured peak for keyOn(0, 69, 127) on this DSP: ~0.93.
        expect(peakAbs(renderBlocks(processor, 48))).toBeGreaterThan(0.5);
    });

    it('FM Synth keyOn dispatch voices the note with nonzero PCM', async () => {
        const processor = await freshProcessor(fmSynth);
        processor.keyOn(0, PITCH_A4, 127);

        // Measured peak for keyOn(0, 69, 127) on this DSP: ~0.999.
        expect(peakAbs(renderBlocks(processor, 48))).toBeGreaterThan(0.3);
    });

    it('overlapping keyOns allocate distinct voices: a chord keeps both notes', async () => {
        const sustained = { from: Math.floor(0.5 * SAMPLE_RATE), to: Math.floor(1.0 * SAMPLE_RATE) };

        const solo = await freshProcessor(rhodes);
        solo.keyOn(0, PITCH_A4, 127);
        const soloOut = renderBlocks(solo, 96);
        const soloA4 = sinusoidalAmplitude(soloOut, FREQ_A4, sustained.from, sustained.to);

        const chord = await freshProcessor(rhodes);
        chord.keyOn(0, PITCH_A4, 127);
        chord.keyOn(0, PITCH_C5, 100);
        const chordOut = renderBlocks(chord, 96);
        const chordA4 = sinusoidalAmplitude(chordOut, FREQ_A4, sustained.from, sustained.to);
        const chordC5 = sinusoidalAmplitude(chordOut, FREQ_C5, sustained.from, sustained.to);

        // The second keyOn must not take over the first voice: A4 survives at
        // least half its solo level, and C5 sounds on its own voice.
        expect(chordA4).toBeGreaterThan(0.5 * soloA4);
        expect(chordA4).toBeGreaterThan(0.03);
        expect(chordC5).toBeGreaterThan(0.03);
    });

    it('keyOff releases only its own note', async () => {
        const processor = await freshProcessor(rhodes);
        processor.keyOn(0, PITCH_A4, 127);
        processor.keyOn(0, PITCH_C5, 100);

        const before = renderBlocks(processor, 48);
        const sustained = { from: Math.floor(0.3 * SAMPLE_RATE), to: before.length };
        const a4Before = sinusoidalAmplitude(before, FREQ_A4, sustained.from, sustained.to);
        const c5Before = sinusoidalAmplitude(before, FREQ_C5, sustained.from, sustained.to);
        expect(a4Before).toBeGreaterThan(0.03);
        expect(c5Before).toBeGreaterThan(0.03);

        processor.keyOff(0, PITCH_A4, 0);
        const after = renderBlocks(processor, 96);
        // Measure past the release tails (0.7 s).
        const released = { from: RELEASE_SETTLE_BLOCKS * BLOCK_SIZE, to: after.length };
        const a4After = sinusoidalAmplitude(after, FREQ_A4, released.from, released.to);
        const c5After = sinusoidalAmplitude(after, FREQ_C5, released.from, released.to);

        // A4 is released (>40 dB down); C5 keeps sounding on its held voice.
        expect(a4After).toBeLessThan(0.01 * a4Before);
        expect(c5After).toBeGreaterThan(20 * a4After);
        expect(c5After).toBeGreaterThan(0.02);
    });
});
