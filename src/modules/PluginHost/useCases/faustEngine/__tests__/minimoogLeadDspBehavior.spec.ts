// @vitest-environment node
import { readFileSync } from 'node:fs';

import {
    FaustMonoDspGenerator,
    type FaustMonoDspGenerator as FaustMonoDspGeneratorType,
    type IFaustCompiler,
} from '@grame/faustwasm/dist/esm/index.js';
import { beforeAll, describe, expect, it } from 'vitest';

import { loadFaustCompilerForSpec } from '../../../testing/loadFaustCompilerForSpec';

/**
 * Behavior proof for minimoog-lead.dsp (#3784):
 * Faust's ve.moogLadder(normFreq, res) expects a normalized frequency input
 * where cf = 20 * 10^(3 * normFreq). Passing linear mod_cutoff / 20000 severely
 * warped the filter cutoff downward (1800 Hz became 37 Hz!).
 *
 * The fix maps Hz to normalized ladder space via:
 *   norm_cutoff = log10(max(20.0, mod_cutoff) / 20.0) / 3.0;
 * and clamps the filter input: min(1.0, max(0.0, norm_cutoff + fenv)).
 */

const DSP_FILE = 'src/modules/PluginHost/useCases/faustEngine/dsp/minimoog-lead.dsp';
const COMPILE_TIMEOUT_MS = 120_000;

type Settings = Record<string, number>;

type UiItem = {
    items?: UiItem[];
    address?: string;
};

const paramAddressMap = new Map<string, string>();

function extractAddresses(items: UiItem[]): void {
    for (const item of items) {
        if (item.items) {
            extractAddresses(item.items);
        } else if (item.address) {
            const bare = item.address.split('/').pop();
            if (bare) {
                paramAddressMap.set(bare, item.address);
            }
        }
    }
}

async function renderMinimoog(
    generator: FaustMonoDspGeneratorType,
    sampleRate: number,
    settings: Settings,
    durationS = 1.0,
    blockSize = 128
): Promise<Float32Array> {
    const processor = await generator.createOfflineProcessor(sampleRate, blockSize);
    processor.start();
    for (const [name, value] of Object.entries(settings)) {
        const address = paramAddressMap.get(name) ?? name;
        processor.setParamValue(address, value);
    }

    const numInputs = processor.getNumInputs();
    const numOutputs = processor.getNumOutputs();
    const inputs = Array.from({ length: numInputs }, () => new Float32Array(blockSize));
    const block = Array.from({ length: numOutputs }, () => new Float32Array(blockSize));

    const total = Math.floor(durationS * sampleRate);
    const output = new Float32Array(total);
    for (let start = 0; start < total; start += blockSize) {
        processor.compute(inputs, block);
        for (let i = 0; i < blockSize; i++) {
            if (start + i < total) {
                output[start + i] = block[0]?.[i] ?? 0;
            }
        }
    }
    return output;
}

function computeSinusoidalAmplitude(
    samples: Float32Array,
    sampleRate: number,
    targetFreq: number,
    startSample: number,
    endSample: number
): number {
    const nSamples = endSample - startSample;
    if (nSamples <= 0) {
        return 0;
    }
    let re = 0;
    let im = 0;
    const omega = (2 * Math.PI * targetFreq) / sampleRate;
    for (let n = startSample; n < endSample; n++) {
        const x = samples[n] ?? 0;
        re += x * Math.cos(omega * n);
        im += x * Math.sin(omega * n);
    }
    re = (2 / nSamples) * re;
    im = (2 / nSamples) * im;
    return Math.hypot(re, im);
}

describe('minimoog-lead.dsp ladder filter cutoff frequency mapping', () => {
    let generator: FaustMonoDspGeneratorType;

    beforeAll(async () => {
        const compiler: IFaustCompiler = await loadFaustCompilerForSpec();
        const dspCode = readFileSync(DSP_FILE, 'utf8');
        const created = new FaustMonoDspGenerator();
        const compiled = await created.compile(compiler, 'minimoog_lead', dspCode, '-I libraries/');
        if (!compiled) {
            throw new Error('minimoog-lead.dsp must compile');
        }
        generator = created;

        const json = JSON.parse(generator.getJSON()) as { ui?: UiItem[] };
        extractAddresses(json.ui ?? []);
    }, COMPILE_TIMEOUT_MS);

    describe('cutoff accuracy across sample rates', () => {
        const sampleRates = [44_100, 48_000, 96_000];

        for (const sampleRate of sampleRates) {
            it(`${sampleRate} Hz: cutoff 1800 Hz passes 440 Hz fundamental and attenuates high harmonics`, async () => {
                const output = await renderMinimoog(generator, sampleRate, {
                    freq: 440,
                    cutoff: 1800,
                    resonance: 1,
                    env_amount: 0,
                    lfo_depth: 0,
                    detune: 0,
                    osc3: 0,
                    glide: 0.001,
                    attack: 0.001,
                    decay: 0.01,
                    sustain: 1.0,
                    release: 0.01,
                    gain: 1.0,
                    gate: 1,
                });

                const startSample = Math.floor(0.5 * sampleRate);
                const endSample = Math.floor(1.0 * sampleRate);

                const fundMag = computeSinusoidalAmplitude(output, sampleRate, 440, startSample, endSample);
                // Fundamental should cleanly pass (previously choked to < 0.002 with linear mapping)
                expect(fundMag).toBeGreaterThan(0.05);

                // 8th harmonic is 3520 Hz (approx 1 octave above 1800 Hz cutoff).
                // In an unattenuated saw, harmonic 8 amplitude is fundMag / 8.
                // The 24 dB/octave ladder filter must attenuate it heavily (> 18 dB attenuation relative to saw).
                const h8Mag = computeSinusoidalAmplitude(output, sampleRate, 3520, startSample, endSample);
                const expectedUnfilteredH8 = fundMag / 8;
                const h8AttenuationDb = 20 * Math.log10(h8Mag / expectedUnfilteredH8);
                expect(h8AttenuationDb).toBeLessThan(-18);
            });

            it(`${sampleRate} Hz: cutoff 80 Hz heavily attenuates 440 Hz fundamental (> 30 dB)`, async () => {
                const startSample = Math.floor(0.5 * sampleRate);
                const endSample = Math.floor(1.0 * sampleRate);

                const outputOpen = await renderMinimoog(generator, sampleRate, {
                    freq: 440,
                    cutoff: 1800,
                    resonance: 1,
                    env_amount: 0,
                    lfo_depth: 0,
                    detune: 0,
                    osc3: 0,
                    glide: 0.001,
                    attack: 0.001,
                    decay: 0.01,
                    sustain: 1.0,
                    release: 0.01,
                    gain: 1.0,
                    gate: 1,
                });
                const fundOpen = computeSinusoidalAmplitude(outputOpen, sampleRate, 440, startSample, endSample);

                const outputChoked = await renderMinimoog(generator, sampleRate, {
                    freq: 440,
                    cutoff: 80,
                    resonance: 1,
                    env_amount: 0,
                    lfo_depth: 0,
                    detune: 0,
                    osc3: 0,
                    glide: 0.001,
                    attack: 0.001,
                    decay: 0.01,
                    sustain: 1.0,
                    release: 0.01,
                    gain: 1.0,
                    gate: 1,
                });
                const fundChoked = computeSinusoidalAmplitude(outputChoked, sampleRate, 440, startSample, endSample);

                const attenuationDb = 20 * Math.log10(fundChoked / fundOpen);
                expect(attenuationDb).toBeLessThan(-30);
            });
        }
    });

    describe('filter envelope modulation', () => {
        it('env_amount opens filter from 200 Hz cutoff by > 20 dB', async () => {
            const sampleRate = 48_000;
            const startSample = Math.floor(0.5 * sampleRate);
            const endSample = Math.floor(1.0 * sampleRate);

            // With env_amount = 0 and cutoff = 200 Hz, 440 Hz is attenuated
            const outputClosed = await renderMinimoog(generator, sampleRate, {
                freq: 440,
                cutoff: 200,
                resonance: 1,
                env_amount: 0,
                lfo_depth: 0,
                detune: 0,
                osc3: 0,
                glide: 0.001,
                attack: 0.001,
                decay: 0.01,
                sustain: 1.0,
                release: 0.01,
                gain: 1.0,
                gate: 1,
            });
            const magClosed = computeSinusoidalAmplitude(outputClosed, sampleRate, 440, startSample, endSample);

            // With env_amount = 0.8 and sustain = 1.0, filter opens to ~20 kHz
            const outputOpen = await renderMinimoog(generator, sampleRate, {
                freq: 440,
                cutoff: 200,
                resonance: 1,
                env_amount: 0.8,
                lfo_depth: 0,
                detune: 0,
                osc3: 0,
                glide: 0.001,
                attack: 0.001,
                decay: 0.01,
                sustain: 1.0,
                release: 0.01,
                gain: 1.0,
                gate: 1,
            });
            const magOpen = computeSinusoidalAmplitude(outputOpen, sampleRate, 440, startSample, endSample);

            const boostDb = 20 * Math.log10(magOpen / magClosed);
            expect(boostDb).toBeGreaterThan(20);
        });
    });

    describe('LFO modulation', () => {
        it('produces finite and clean audio under active LFO cutoff modulation', async () => {
            const sampleRate = 48_000;
            const output = await renderMinimoog(generator, sampleRate, {
                freq: 440,
                cutoff: 1800,
                resonance: 4,
                env_amount: 0.3,
                lfo_rate: 5,
                lfo_depth: 0.5,
                gain: 0.8,
                gate: 1,
            });

            expect(output.length).toBeGreaterThan(0);
            let sumSq = 0;
            for (let i = 0; i < output.length; i++) {
                const s = output[i];
                expect(Number.isFinite(s)).toBe(true);
                sumSq += (s ?? 0) * (s ?? 0);
            }
            const rms = Math.sqrt(sumSq / output.length);
            expect(rms).toBeGreaterThan(0.01);
        });
    });

    describe('extreme and boundary stability', () => {
        const sampleRates = [44_100, 48_000, 96_000];

        for (const sampleRate of sampleRates) {
            it(`${sampleRate} Hz: remains stable with max cutoff (18000), max resonance (25), and max freq (12000)`, async () => {
                const output = await renderMinimoog(
                    generator,
                    sampleRate,
                    {
                        freq: 12_000,
                        cutoff: 18_000,
                        resonance: 25,
                        env_amount: 1.0,
                        gain: 1.0,
                        gate: 1,
                    },
                    0.2
                );

                expect(output.length).toBeGreaterThan(0);
                for (let i = 0; i < output.length; i++) {
                    expect(Number.isFinite(output[i])).toBe(true);
                }
            });
        }
    });

    describe('presets sanity', () => {
        it('Classic Lead renders finite audio with audible fundamental', async () => {
            const sampleRate = 48_000;
            const output = await renderMinimoog(generator, sampleRate, {
                freq: 440,
                glide: 0.08,
                detune: 7,
                osc3: 0.3,
                cutoff: 2500,
                resonance: 4,
                env_amount: 0.4,
                attack: 0.005,
                decay: 0.25,
                sustain: 0.6,
                release: 0.3,
                gain: 0.5,
                gate: 1,
            });

            for (let i = 0; i < output.length; i++) {
                expect(Number.isFinite(output[i])).toBe(true);
            }
            const mag = computeSinusoidalAmplitude(
                output,
                sampleRate,
                440,
                Math.floor(0.4 * sampleRate),
                Math.floor(0.8 * sampleRate)
            );
            expect(mag).toBeGreaterThan(0.01);
        });

        it('Screaming Lead renders finite audio with audible fundamental', async () => {
            const sampleRate = 48_000;
            const output = await renderMinimoog(generator, sampleRate, {
                freq: 440,
                glide: 0.12,
                detune: 15,
                osc3: 0.5,
                cutoff: 3500,
                resonance: 18,
                env_amount: 0.6,
                attack: 0.01,
                decay: 0.2,
                sustain: 0.5,
                release: 0.4,
                gain: 0.45,
                gate: 1,
            });

            let sumSq = 0;
            for (let i = 0; i < output.length; i++) {
                const s = output[i];
                expect(Number.isFinite(s)).toBe(true);
                sumSq += (s ?? 0) * (s ?? 0);
            }
            const rms = Math.sqrt(sumSq / output.length);
            expect(rms).toBeGreaterThan(0.01);

            const mag = computeSinusoidalAmplitude(
                output,
                sampleRate,
                440,
                Math.floor(0.4 * sampleRate),
                Math.floor(0.8 * sampleRate)
            );
            expect(mag).toBeGreaterThan(0.001);
        });

        it('Moog Bass renders finite audio with audible fundamental', async () => {
            const sampleRate = 48_000;
            const output = await renderMinimoog(generator, sampleRate, {
                freq: 110,
                glide: 0.05,
                detune: 5,
                osc3: 0.4,
                cutoff: 800,
                resonance: 6,
                env_amount: 0.5,
                attack: 0.003,
                decay: 0.15,
                sustain: 0.4,
                release: 0.15,
                gain: 0.55,
                gate: 1,
            });

            for (let i = 0; i < output.length; i++) {
                expect(Number.isFinite(output[i])).toBe(true);
            }
            const mag = computeSinusoidalAmplitude(
                output,
                sampleRate,
                110,
                Math.floor(0.3 * sampleRate),
                Math.floor(0.7 * sampleRate)
            );
            expect(mag).toBeGreaterThan(0.01);
        });
    });
});
