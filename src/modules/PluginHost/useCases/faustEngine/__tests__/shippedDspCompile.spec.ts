// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// The package's "main" CJS bundle exposes no runtime exports under Node SSR
// resolution; the ESM build (what Vite serves the app) does.
import { FaustMonoDspGenerator, type IFaustCompiler } from '@grame/faustwasm/dist/esm/index.js';
import { describe, expect, it, beforeAll } from 'vitest';

import { getPluginById } from '#/modules/Arrangement/useCases';

import { type FaustModule } from '../../../models/FaustEngineTypes';
import { loadFaustCompilerForSpec } from '../../../testing/loadFaustCompilerForSpec';
import { registerBuiltinFaustDSP } from '../builtinDSP';
import { faustEngineState } from '../faustEngineState';

/**
 * Compiles every shipped .dsp through the app's own Faust path
 * (compileFaustDSP.ts: libfaust wasm + '-I libraries/') so a built-in that
 * cannot compile — and would be silently skipped by faustDeviceFactory — fails
 * CI instead of shipping dead (audit #508 row 7: spring-reverb.dsp had four
 * undefined free identifiers while factory templates referenced the device).
 *
 * It also holds the two parameter tables that describe these modules against
 * what the compiler actually produced.
 *
 * `FaustEffectDescriptors.ts`, reached here through `getPluginById` exactly as
 * the app reaches it, is the load-bearing one: it is what the device inspector
 * renders and what `clampDeviceParameterValue` and the AudioParam bounds hold
 * every write to. Name resolution alone is not enough to keep it honest,
 * because a name that resolves onto a DIFFERENT SCALE is just as dead as a name
 * that resolves onto nothing — the Stereo Widener declared 0..2 against a DSP
 * reading percent, so the widest setting the UI could reach was an effective
 * width of 0.02 and the device collapsed to near-mono at maximum Width. So the
 * ranges are compared too, in both directions: every declared parameter must
 * exist in the compiled node with the same min/max/default, and every input
 * control the compiled node exposes must be declared, or it is a repair that
 * exists in the DSP and is invisible in the product.
 *
 * `builtinDSP.ts`'s own `paramDescriptors` are compared as well, for address
 * resolution only. That table has NO runtime reader today — `getFaustModule`
 * and `getFaustModules` are called from specs and nothing else — so this is a
 * consistency check on a description, not a contract the product depends on;
 * `builtinDSP.ts` earns its place by registering the DSP SOURCE, which
 * `compileFaustDSP` does read. Removing the dead descriptor arrays is filed
 * separately rather than smuggled in here.
 */

const DSP_DIR = 'src/modules/PluginHost/useCases/faustEngine/dsp';
const COMPILE_TIMEOUT_MS = 300_000;

/**
 * Compile-failure baseline — EMPTY since #508 rows 19+20 repaired the last
 * broken files (noise-gate, de-esser, stereo-widener). The exact-set
 * mechanism stays: any NEW compile failure fails this test; if a file ever
 * has to ship broken, add it here with the reason.
 */
const KNOWN_BROKEN: string[] = [];

/** One leaf of the compiled node's `ui` tree. */
type CompiledParam = {
    address: string;
    type: string;
    min?: number;
    max?: number;
    init?: number;
};

type CompiledDsp = {
    failures: Record<string, string>;
    /** file name → compiled UI leaves, sorted by address. */
    params: Record<string, CompiledParam[]>;
    /** file name → the built-in that ships that source, when registered. */
    moduleOf: Record<string, FaustModule>;
};

type UiItem = {
    items?: UiItem[];
    address?: string;
    type?: string;
    min?: number;
    max?: number;
    init?: number;
};

function paramsOf(generator: FaustMonoDspGenerator): CompiledParam[] {
    const params: CompiledParam[] = [];
    const walk = (items: UiItem[]): void => {
        for (const item of items) {
            if (item.items) {
                walk(item.items);
            } else if (item.address) {
                params.push({
                    address: item.address,
                    type: item.type ?? 'unknown',
                    min: item.min,
                    max: item.max,
                    init: item.init,
                });
            }
        }
    };
    const json = JSON.parse(generator.getJSON()) as { ui?: UiItem[] };
    walk(json.ui ?? []);
    return params.sort((left, right) => left.address.localeCompare(right.address));
}

/**
 * A `vbargraph`/`hbargraph` is an OUTPUT — a meter reading, not a control. The
 * Faust processor does not surface these as AudioParams and no descriptor
 * declares them, so they are excluded from both directions of the range check.
 */
const OUTPUT_TYPES = new Set(['hbargraph', 'vbargraph']);

/**
 * A `checkbox`/`button` carries no min/max/init in the compiled JSON because it
 * has no range to carry: it is 0 or 1, resting at 0. That IS its declared
 * range, so a descriptor has to say the same thing.
 */
const TOGGLE_RANGE = { min: 0, max: 1, init: 0 } as const;

function compiledRangeOf(item: CompiledParam): { min: number; max: number; init: number } | null {
    if (item.type === 'checkbox' || item.type === 'button') {
        return TOGGLE_RANGE;
    }
    if (item.min === undefined || item.max === undefined || item.init === undefined) {
        return null;
    }
    return { min: item.min, max: item.max, init: item.init };
}

/**
 * Faust writes the compiled UI bounds as float32, so a source `0.3` comes back
 * as `0.30000001192092896`. Compare relatively rather than exactly; the drift
 * this test exists to catch is a factor of 100, not a last-bit rounding.
 */
function sameNumber(declared: number, compiledValue: number): boolean {
    return Math.abs(declared - compiledValue) <= Math.max(1e-6, Math.abs(compiledValue) * 1e-6);
}

/**
 * The segment `faustDeviceFactory.buildParamAddressCache` keys on. Group
 * nesting and the processor-name prefix are NOT part of the contract; the last
 * segment is.
 */
function bareName(address: string): string {
    return address.split('/').pop() ?? address;
}

function bareNamesOf(file: string, compiled: CompiledDsp): string[] {
    return (compiled.params[file] ?? []).map((param) => bareName(param.address)).sort();
}

describe('shipped Faust DSP compile', () => {
    let compiler: IFaustCompiler;
    let compiled: CompiledDsp;

    beforeAll(async () => {
        compiler = await loadFaustCompilerForSpec();
        registerBuiltinFaustDSP();

        // `builtinDSP.ts` imports each .dsp with `?raw`, so the registered
        // source is byte-identical to the file it came from.
        const moduleBySource = new Map<string, FaustModule>();
        for (const module of faustEngineState.modules.values()) {
            moduleBySource.set(module.dspCode, module);
        }

        const failures: Record<string, string> = {};
        const params: Record<string, CompiledParam[]> = {};
        const moduleOf: Record<string, FaustModule> = {};
        const files = readdirSync(DSP_DIR)
            .filter((name) => name.endsWith('.dsp'))
            .sort();
        for (const file of files) {
            const dspCode = readFileSync(join(DSP_DIR, file), 'utf8');
            const module = moduleBySource.get(dspCode);
            if (module) {
                moduleOf[file] = module;
            }
            // Same processor name compileFaustDSP.ts uses, so the compiled
            // addresses are the ones the running app resolves against.
            const processorName = module ? module.name.replaceAll(/\s+/g, '_') : file.replace(/\.dsp$/, '');
            const generator = new FaustMonoDspGenerator();
            try {
                const result = await generator.compile(compiler, processorName, dspCode, '-I libraries/');
                if (result) {
                    params[file] = paramsOf(generator);
                } else {
                    failures[file] = 'compile returned null';
                }
            } catch (error) {
                failures[file] = error instanceof Error ? error.message : String(error);
            }
        }
        compiled = { failures, params, moduleOf };
    }, COMPILE_TIMEOUT_MS);

    it('compiles every shipped .dsp except the documented known-broken set', () => {
        expect(Object.keys(compiled.failures).sort()).toEqual(KNOWN_BROKEN);
    });

    it('registers every shipped .dsp as a built-in', () => {
        const unregistered = Object.keys(compiled.params)
            .filter((file) => !compiled.moduleOf[file])
            .sort();
        expect(unregistered).toEqual([]);
    });

    it('declares the range the compiled node implements, for every catalog parameter', () => {
        // The check that would have caught the Stereo Widener shipping 0..2
        // against a DSP reading 0..200 percent. `clampDeviceParameterValue` and
        // the AudioParam bounds both hold a write to the DECLARED range, so a
        // declared range narrower than the DSP's puts part of the control out
        // of reach, and a declared range on a different scale puts nearly all
        // of it out of reach while every name still resolves.
        const drift: Record<string, string[]> = {};
        for (const [file, module] of Object.entries(compiled.moduleOf)) {
            const descriptor = getPluginById(module.id);
            if (!descriptor) {
                continue;
            }
            const compiledByName = new Map(
                (compiled.params[file] ?? []).map((param) => [bareName(param.address), param])
            );
            const problems: string[] = [];
            for (const parameter of descriptor.parameters) {
                const item = compiledByName.get(parameter.id);
                if (!item) {
                    problems.push(`${parameter.id}: no compiled parameter carries that name`);
                    continue;
                }
                const range = compiledRangeOf(item);
                if (!range) {
                    problems.push(`${parameter.id}: compiled ${item.type} declares no range`);
                    continue;
                }
                if (!sameNumber(parameter.minValue, range.min)) {
                    problems.push(`${parameter.id}: min ${parameter.minValue} vs compiled ${range.min}`);
                }
                if (!sameNumber(parameter.maxValue, range.max)) {
                    problems.push(`${parameter.id}: max ${parameter.maxValue} vs compiled ${range.max}`);
                }
                if (!sameNumber(parameter.defaultValue, range.init)) {
                    problems.push(`${parameter.id}: default ${parameter.defaultValue} vs compiled ${range.init}`);
                }
            }
            if (problems.length > 0) {
                drift[descriptor.id] = problems;
            }
        }
        expect(drift).toEqual({});
    });

    it('declares every input control the compiled node exposes', () => {
        // The other direction. `gain-utility.dsp` grew a working phase invert
        // that no descriptor mentioned, and `hasCustomUI` is false for all of
        // these, so the inspector renders the declared list and nothing else: a
        // repair real in the DSP and invisible in the product.
        const undeclared: Record<string, string[]> = {};
        for (const [file, module] of Object.entries(compiled.moduleOf)) {
            const descriptor = getPluginById(module.id);
            if (!descriptor) {
                continue;
            }
            const declared = new Set(descriptor.parameters.map((parameter) => parameter.id));
            const missing = (compiled.params[file] ?? [])
                .filter((param) => !OUTPUT_TYPES.has(param.type))
                .map((param) => bareName(param.address))
                .filter((name) => !declared.has(name))
                .sort();
            if (missing.length > 0) {
                undeclared[descriptor.id] = missing;
            }
        }
        expect(undeclared).toEqual({});
    });

    it('resolves every address declared in builtinDSP.ts against the compiled node', () => {
        // The check that would have caught #2300. Failure names the device and
        // the declared addresses whose last segment no built-in parameter
        // carries — exactly the ones faustDeviceFactory would drop into a warn.
        const unresolved: Record<string, string[]> = {};
        for (const [file, module] of Object.entries(compiled.moduleOf)) {
            const available = new Set(bareNamesOf(file, compiled));
            const missing = module.paramDescriptors
                .map((descriptor) => descriptor.address)
                .filter((address) => !available.has(bareName(address)))
                .sort();
            if (missing.length > 0) {
                unresolved[module.name] = missing;
            }
        }
        expect(unresolved).toEqual({});
    });

    it('keeps every built-in parameter name unambiguous', () => {
        // buildParamAddressCache keys by last segment and keeps the first of a
        // collision, so two parameters sharing one name make the loser
        // unreachable from the device UI.
        const ambiguous: Record<string, string[]> = {};
        for (const [file, module] of Object.entries(compiled.moduleOf)) {
            const seen = new Set<string>();
            const duplicates = new Set<string>();
            for (const name of bareNamesOf(file, compiled)) {
                if (seen.has(name)) {
                    duplicates.add(name);
                }
                seen.add(name);
            }
            if (duplicates.size > 0) {
                ambiguous[module.name] = [...duplicates].sort();
            }
        }
        expect(ambiguous).toEqual({});
    });

    it('multiband-compressor.dsp exposes the three thresholds and both crossovers', () => {
        expect(compiled.failures['multiband-compressor.dsp']).toBeUndefined();
        expect(bareNamesOf('multiband-compressor.dsp', compiled)).toEqual([
            'crossover_high',
            'crossover_low',
            'high_threshold',
            'low_threshold',
            'mid_threshold',
        ]);
    });

    it('brick-wall-limiter.dsp exposes ceiling, release and lookahead', () => {
        expect(compiled.failures['brick-wall-limiter.dsp']).toBeUndefined();
        expect(bareNamesOf('brick-wall-limiter.dsp', compiled)).toEqual(['ceiling', 'lookahead', 'release']);
    });

    it('spring-reverb.dsp compiles and exposes the params its descriptors declare', () => {
        // builtinDSP.ts declares /spring/decay, /spring/brightness, /spring/mix;
        // FaustEffectDescriptors.ts exposes all three in the device UI.
        expect(compiled.failures['spring-reverb.dsp']).toBeUndefined();
        expect(bareNamesOf('spring-reverb.dsp', compiled)).toEqual(['brightness', 'decay', 'mix']);
    });

    it('noise-gate.dsp compiles and exposes the params its descriptors declare', () => {
        // builtinDSP.ts declares /Noise_Gate/{threshold,attack,hold,release}.
        expect(compiled.failures['noise-gate.dsp']).toBeUndefined();
        expect(bareNamesOf('noise-gate.dsp', compiled)).toEqual(['attack', 'hold', 'release', 'threshold']);
    });

    it('de-esser.dsp compiles and exposes the params its descriptors declare', () => {
        // builtinDSP.ts declares /De-esser/{frequency,bandwidth,threshold,ratio,listen}.
        expect(compiled.failures['de-esser.dsp']).toBeUndefined();
        expect(bareNamesOf('de-esser.dsp', compiled)).toEqual([
            'bandwidth',
            'frequency',
            'listen',
            'ratio',
            'reduction',
            'threshold',
        ]);
    });

    it('stereo-widener.dsp compiles and exposes the params its descriptors declare', () => {
        // builtinDSP.ts declares /Stereo_Widener/{width,mono_bass}.
        expect(compiled.failures['stereo-widener.dsp']).toBeUndefined();
        expect(bareNamesOf('stereo-widener.dsp', compiled)).toEqual(['mono_bass', 'width']);
    });
});
