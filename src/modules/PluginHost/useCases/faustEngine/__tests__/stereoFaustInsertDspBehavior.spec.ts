// @vitest-environment node
import { readFileSync } from 'node:fs';

// The package's "main" CJS bundle exposes no runtime exports under Node SSR
// resolution; the ESM build (what Vite serves the app) does.
import {
    FaustMonoDspGenerator,
    type FaustMonoDspGenerator as FaustMonoDspGeneratorType,
    type IFaustCompiler,
} from '@grame/faustwasm/dist/esm/index.js';
import { beforeAll, describe, expect, it } from 'vitest';

import { loadFaustCompilerForSpec } from '../../../testing/loadFaustCompilerForSpec';

/**
 * Stereo-preservation proof for the mono-built Faust inserts (#3730):
 * Pro Parametric EQ, Tape Delay and Spring Reverb used to compile 1-in/1-out,
 * and the Faust AudioWorklet node pins `channelCount` to the DSP input count
 * with explicit/speakers interpretation — a stereo insert was downmixed to
 * (L+R)/2 before the DSP and duplicated mono after it, so antiphase content
 * vanished even at flat EQ, dry_wet 0 and mix 0.
 *
 * The fix duplicates the mono chain per channel in the DSP itself
 * (`par(i, 2, ...)`), the canonical Faust stereo idiom. Same-path UI items
 * merge into one zone, so the two channel copies share one control surface
 * and every parameter address, range and automation binding is unchanged.
 *
 * Mutation probes these tests encode:
 * - reverting a DSP to the mono `process` fails the arity assertion (1/1);
 * - a stereo build whose channels did not share the control surface fails the
 *   shared-surface render (identical inputs must produce identical channels).
 */

const DSP_DIR = 'src/modules/PluginHost/useCases/faustEngine/dsp';
const COMPILE_TIMEOUT_MS = 180_000;

const SAMPLE_RATE = 48_000;
const BLOCK_SIZE = 512;
/** Enough blocks for the stateful wet paths (delay lines, freeverb) to settle. */
const WARMUP_BLOCKS = 96;
const MEASURE_BLOCKS = 20;

type UiItem = {
    items?: UiItem[];
    address?: string;
};

type StereoDeviceCase = {
    file: string;
    processorName: string;
    /** The bare parameter names the compiled node must expose, once each. */
    expectedParams: string[];
    /** Dry/flat: the device must pass its input through effectively unchanged. */
    neutral: Record<string, number>;
    /** One load-bearing control that must move BOTH channels when turned. */
    shared: { param: string; value: number };
    probeFrequency: number;
};

const CASES: StereoDeviceCase[] = [
    {
        file: 'pro-parametric-eq.dsp',
        processorName: 'Pro_Parametric_EQ',
        expectedParams: ['hf_freq', 'hf_gain', 'lf_freq', 'lf_gain', 'mf_freq', 'mf_gain', 'mf_q'],
        neutral: { lf_gain: 0, mf_gain: 0, hf_gain: 0 },
        shared: { param: 'mf_gain', value: 18 },
        probeFrequency: 1000,
    },
    {
        file: 'tape-delay.dsp',
        processorName: 'Tape_Delay',
        expectedParams: ['delay', 'dry_wet', 'feedback', 'tone'],
        neutral: { dry_wet: 0 },
        shared: { param: 'dry_wet', value: 0.8 },
        probeFrequency: 440,
    },
    {
        file: 'spring-reverb.dsp',
        processorName: 'Spring_Reverb',
        expectedParams: ['brightness', 'decay', 'mix'],
        neutral: { mix: 0 },
        shared: { param: 'mix', value: 0.6 },
        probeFrequency: 440,
    },
];

type CompiledCase = {
    caseConfig: StereoDeviceCase;
    generator: FaustMonoDspGeneratorType;
    addresses: Map<string, string>;
};

function extractAddresses(items: UiItem[], into: Map<string, string>): void {
    for (const item of items) {
        if (item.items) {
            extractAddresses(item.items, into);
        } else if (item.address) {
            const bare = item.address.split('/').pop();
            if (bare) {
                into.set(bare, item.address);
            }
        }
    }
}

/** Fresh processor per render: the stateful wet paths must not leak between measurements. */
async function renderChannels(
    compiled: CompiledCase,
    settings: Record<string, number>,
    channelInputs: [(n: number) => number, (n: number) => number]
): Promise<{ left: Float32Array; right: Float32Array }> {
    const processor = await compiled.generator.createOfflineProcessor(SAMPLE_RATE, BLOCK_SIZE);
    processor.start();
    for (const [name, value] of Object.entries(settings)) {
        const address = compiled.addresses.get(name) ?? name;
        processor.setParamValue(address, value);
    }

    const numInputs = processor.getNumInputs();
    const numOutputs = processor.getNumOutputs();
    const inputs = Array.from({ length: numInputs }, () => new Float32Array(BLOCK_SIZE));
    const block = Array.from({ length: numOutputs }, () => new Float32Array(BLOCK_SIZE));

    const fill = () => {
        for (let n = 0; n < BLOCK_SIZE; n++) {
            for (let channel = 0; channel < numInputs; channel++) {
                const source = channelInputs[Math.min(channel, 1)]!;
                inputs[channel]![n] = source(n);
            }
        }
    };
    fill();
    for (let i = 0; i < WARMUP_BLOCKS; i++) {
        processor.compute(inputs, block);
    }

    const total = MEASURE_BLOCKS * BLOCK_SIZE;
    const left = new Float32Array(total);
    const right = new Float32Array(total);
    for (let b = 0; b < MEASURE_BLOCKS; b++) {
        processor.compute(inputs, block);
        for (let i = 0; i < BLOCK_SIZE; i++) {
            left[b * BLOCK_SIZE + i] = block[0]?.[i] ?? 0;
            right[b * BLOCK_SIZE + i] = block[1]?.[i] ?? 0;
        }
    }
    return { left, right };
}

function rms(signal: Float32Array): number {
    let energy = 0;
    for (const sample of signal) {
        energy += sample * sample;
    }
    return Math.sqrt(energy / signal.length);
}

function maxAbs(signal: Float32Array): number {
    let peak = 0;
    for (const sample of signal) {
        peak = Math.max(peak, Math.abs(sample));
    }
    return peak;
}

describe('stereo Faust inserts keep L/R through the mono chains (#3730)', () => {
    const compiledCases: CompiledCase[] = [];

    beforeAll(async () => {
        const compiler: IFaustCompiler = await loadFaustCompilerForSpec();
        for (const caseConfig of CASES) {
            const dspCode = readFileSync(`${DSP_DIR}/${caseConfig.file}`, 'utf8');
            const generator = new FaustMonoDspGenerator();
            const result = await generator.compile(compiler, caseConfig.processorName, dspCode, '-I libraries/');
            if (!result) {
                throw new Error(`${caseConfig.file} must compile`);
            }
            const addresses = new Map<string, string>();
            const json = JSON.parse(generator.getJSON()) as { ui?: UiItem[] };
            extractAddresses(json.ui ?? [], addresses);
            compiledCases.push({ caseConfig, generator, addresses });
        }
    }, COMPILE_TIMEOUT_MS);

    for (const entry of CASES) {
        describe(entry.file, () => {
            let compiled: CompiledCase;

            beforeAll(() => {
                compiled = compiledCases.find((c) => c.caseConfig.file === entry.file)!;
            });

            it('compiles the mono chain duplicated per channel: two inputs, two outputs', () => {
                const json = JSON.parse(compiled.generator.getJSON()) as { inputs: number; outputs: number };
                // The mono source compiled 1/1, and the Faust worklet pins
                // channelCount/outputChannelCount to those counts, which is
                // what downmixed the insert. 2/2 is the stereo contract.
                expect(json.inputs).toBe(2);
                expect(json.outputs).toBe(2);
            });

            it('exposes one shared control surface, not one per channel', () => {
                expect([...compiled.addresses.keys()].sort()).toEqual(entry.expectedParams);
            });

            it('preserves antiphase stereo at dry/flat settings instead of collapsing to mono', async () => {
                const probe = (n: number) => 0.5 * Math.sin((2 * Math.PI * entry.probeFrequency * n) / SAMPLE_RATE);
                const { left, right } = await renderChannels(compiled, entry.neutral, [probe, (n) => -probe(n)]);

                // A speakers downmix to mono makes (L+R)/2 exactly zero for
                // antiphase input; both channels must carry the full signal.
                expect(rms(left)).toBeGreaterThan(0.3);
                expect(rms(right)).toBeGreaterThan(0.3);
                // Duplicating the mono result downstream would give L === R;
                // the duplicated per-channel chains keep R === -L.
                let antiphaseResidue = 0;
                for (let i = 0; i < left.length; i++) {
                    antiphaseResidue = Math.max(antiphaseResidue, Math.abs(left[i]! + right[i]!));
                }
                expect(antiphaseResidue).toBeLessThan(1e-6);
            });

            it('drives both channels from the shared control surface', async () => {
                const probe = (n: number) => 0.5 * Math.sin((2 * Math.PI * entry.probeFrequency * n) / SAMPLE_RATE);
                const neutral = await renderChannels(compiled, entry.neutral, [probe, probe]);
                const changed = await renderChannels(
                    compiled,
                    { ...entry.neutral, [entry.shared.param]: entry.shared.value },
                    [probe, probe]
                );

                // Identical input into identical channel chains must produce
                // sample-identical channels; a control that only reached one
                // channel's zone would split them.
                let channelDivergence = 0;
                for (let i = 0; i < changed.left.length; i++) {
                    channelDivergence = Math.max(channelDivergence, Math.abs(changed.left[i]! - changed.right[i]!));
                }
                expect(channelDivergence).toBeLessThan(1e-6);

                // And the control must actually reach them: the render moves
                // away from the dry/flat reference.
                const neutralLevel = rms(neutral.left);
                const changedLevel = rms(changed.left);
                expect(Math.abs(changedLevel - neutralLevel)).toBeGreaterThan(0.05);
                expect(maxAbs(changed.left)).toBeGreaterThan(0.05);
            });
        });
    }
});
