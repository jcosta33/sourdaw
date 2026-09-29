// @vitest-environment node
import { readFileSync } from 'node:fs';

import { FaustMonoDspGenerator, FaustPolyDspGenerator, type IFaustCompiler } from '@grame/faustwasm/dist/esm/index.js';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerProSynthInstruments } from '#/modules/Synth/useCases';

import { loadFaustCompilerForSpec } from '../../../testing/loadFaustCompilerForSpec';
import { registerBuiltinFaustDSP } from '../builtinDSP';
import { compileEffectFreeFaustPolyDsp } from '../compileEffectFreeFaustPolyDsp';
import { compileFaustDSP } from '../compileFaustDSP';
import { faustEngineState } from '../faustEngineState';
import { registerFaustDSP } from '../registerFaustDSP';
import { registerSupersawUnison } from '../registerSupersawUnison';

const mocks = vi.hoisted(() => ({ getFaustCompiler: vi.fn() }));

vi.mock('@grame/faustwasm', async () => import('@grame/faustwasm/dist/esm/index.js'));
vi.mock('../compilerEngine', () => ({ getFaustCompiler: mocks.getFaustCompiler }));

describe('compileFaustDSP effect-free instrument', () => {
    let compiler: IFaustCompiler;

    beforeAll(async () => {
        compiler = await loadFaustCompilerForSpec();
    }, 120_000);

    beforeEach(() => {
        mocks.getFaustCompiler.mockResolvedValue(compiler);
    });

    it('compiles the registered Supersaw voice without probing an absent effect', async () => {
        const factoryInputs: string[] = [];
        const tracedCompiler = new Proxy(compiler, {
            get(target, property) {
                if (property !== 'createPolyDSPFactory') {
                    return Reflect.get(target, property);
                }
                return async (name: string, code: string, args: string) => {
                    factoryInputs.push(code);
                    return target.createPolyDSPFactory(name, code, args);
                };
            },
        });
        mocks.getFaustCompiler.mockResolvedValue(tracedCompiler);
        registerSupersawUnison();

        expect(await compileFaustDSP('faust-supersaw-unison')).toBe(true);
        expect(factoryInputs).toEqual([
            readFileSync('src/modules/PluginHost/useCases/faustEngine/dsp/supersaw-unison.dsp', 'utf8'),
        ]);
        const module = faustEngineState.modules.get('faust-supersaw-unison');
        expect(module?.compiled).toBe(true);
        const generator = module?.generator;
        expect(generator).toBeInstanceOf(FaustPolyDspGenerator);
        if (!(generator instanceof FaustPolyDspGenerator)) {
            throw new Error('Supersaw must use a polyphonic generator');
        }
        expect(generator.effectFactory).toBeNull();

        const processor = await generator.createOfflineProcessor(48_000, 128, 8);
        processor.start();
        expect(processor.getNumInputs()).toBe(0);
        processor.keyOn(0, 69, 127);
        const output = [new Float32Array(128), new Float32Array(128)];
        let peak = 0;
        for (let block = 0; block < 64; block += 1) {
            processor.compute([], output);
            for (const channel of output) {
                for (const sample of channel) {
                    peak = Math.max(peak, Math.abs(sample));
                }
            }
        }
        expect(peak).toBeGreaterThan(0.05);
    }, 120_000);

    it('keeps the vendor effect path for an unmarked polyphonic source', async () => {
        const source = 'import("stdfaust.lib"); process = os.osc(440); effect = _;';
        const module = registerFaustDSP('Effectful Probe', source, [], true);
        const factoryInputs: string[] = [];
        const tracedCompiler = new Proxy(compiler, {
            get(target, property) {
                if (property !== 'createPolyDSPFactory') {
                    return Reflect.get(target, property);
                }
                return async (name: string, code: string, args: string) => {
                    factoryInputs.push(code);
                    return target.createPolyDSPFactory(name, code, args);
                };
            },
        });
        mocks.getFaustCompiler.mockResolvedValue(tracedCompiler);

        expect(await compileFaustDSP(module.id)).toBe(true);
        expect(factoryInputs[0]).toContain('process = dsp_code.effect;');
        expect(module.generator).toBeInstanceOf(FaustPolyDspGenerator);
        if (!(module.generator instanceof FaustPolyDspGenerator)) {
            throw new Error('Effectful source must use a polyphonic generator');
        }
        expect(module.generator.effectFactory).not.toBeNull();
    }, 120_000);

    it('compiles every declared effect-free shipped instrument through one voice factory call', async () => {
        registerBuiltinFaustDSP();
        registerProSynthInstruments();
        const modules = Array.from(faustEngineState.modules.values()).filter(
            (module) => module.polyEffectMode === 'none'
        );
        expect(modules.map((module) => module.name).sort()).toEqual([
            'Acid Bass 303',
            'Additive Synth',
            'FM Synth',
            'Hammond B3',
            'Minimoog Lead',
            'Morphing Synth',
            'Physical Model String',
            'Rhodes',
            'Supersaw Unison',
        ]);
        const factoryInputs: string[] = [];
        const tracedCompiler = new Proxy(compiler, {
            get(target, property) {
                if (property !== 'createPolyDSPFactory') {
                    return Reflect.get(target, property);
                }
                return async (name: string, code: string, args: string) => {
                    factoryInputs.push(code);
                    return target.createPolyDSPFactory(name, code, args);
                };
            },
        });
        mocks.getFaustCompiler.mockResolvedValue(tracedCompiler);

        for (const module of modules) {
            expect(await compileFaustDSP(module.id), module.name).toBe(true);
        }
        expect(factoryInputs).toEqual(modules.map((module) => module.dspCode));
    }, 120_000);

    it('keeps mono sources on the mono generator', async () => {
        const module = registerFaustDSP('Mono Probe', 'process = _;');

        expect(await compileFaustDSP(module.id)).toBe(true);
        expect(module.generator).toBeInstanceOf(FaustMonoDspGenerator);
    }, 120_000);

    it('selects the double-precision mixer for a double-precision voice', async () => {
        const mixerPrecisions: boolean[] = [];
        const tracedCompiler = new Proxy(compiler, {
            get(target, property) {
                if (property !== 'getAsyncInternalMixerModule') {
                    return Reflect.get(target, property);
                }
                return async (isDouble: boolean) => {
                    mixerPrecisions.push(isDouble);
                    return target.getAsyncInternalMixerModule(isDouble);
                };
            },
        });
        const source = readFileSync('src/modules/PluginHost/useCases/faustEngine/dsp/supersaw-unison.dsp', 'utf8');

        const generator = await compileEffectFreeFaustPolyDsp(
            tracedCompiler,
            'Supersaw_Double_Probe',
            source,
            '-I libraries/ -double'
        );
        expect(generator).not.toBeNull();
        expect(mixerPrecisions).toEqual([true]);
        const processor = await generator!.createOfflineProcessor(48_000, 128, 8);
        processor.start();
        processor.keyOn(0, 69, 127);
        const output = [new Float64Array(128), new Float64Array(128)];
        let peak = 0;
        for (let block = 0; block < 64; block += 1) {
            processor.compute([], output);
            for (const channel of output) {
                for (const sample of channel) {
                    peak = Math.max(peak, Math.abs(sample));
                }
            }
        }
        expect(peak).toBeGreaterThan(0.05);
    }, 120_000);

    it('still rejects invalid effect-free instrument source', async () => {
        const module = registerFaustDSP('Invalid Poly Probe', 'process = nonexistent;', [], true, 'none');

        expect(await compileFaustDSP(module.id)).toBe(false);
        expect(module.compiled).toBe(false);
        expect(module.generator).toBeNull();
    }, 120_000);
});
