// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// The package's "main" CJS bundle exposes no runtime exports under Node SSR
// resolution; the ESM build (what Vite serves the app) does.
import { FaustMonoDspGenerator, type IFaustCompiler } from '@grame/faustwasm/dist/esm/index.js';
import { describe, expect, it, beforeAll } from 'vitest';

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
 * It also compares the compiled parameter set of EVERY registered built-in
 * against the addresses `builtinDSP.ts` declares for it. `faustDeviceFactory`
 * resolves a declared address to a compiled one by its LAST path segment
 * (`buildParamAddressCache`), then swallows a miss into a `logger.warn` — so a
 * declared address with no matching segment ships as a knob that moves and
 * changes nothing. That is a defect in the descriptor table, not a runtime
 * condition, and this is where it is caught (#2300: Multiband Compressor and
 * Brick-Wall Limiter each shipped a stock library one-liner with no `hslider`
 * at all while declaring five and three controls respectively).
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

type CompiledDsp = {
    failures: Record<string, string>;
    /** file name → sorted compiled parameter addresses. */
    paramPaths: Record<string, string[]>;
    /** file name → the built-in that ships that source, when registered. */
    moduleOf: Record<string, FaustModule>;
};

function paramPathsOf(generator: FaustMonoDspGenerator): string[] {
    const paths: string[] = [];
    const walk = (items: { items?: unknown[]; address?: string }[]): void => {
        for (const item of items) {
            if (item.items) {
                walk(item.items as typeof items);
            } else if (item.address) {
                paths.push(item.address);
            }
        }
    };
    const json = JSON.parse(generator.getJSON()) as { ui?: { items?: unknown[]; address?: string }[] };
    walk(json.ui ?? []);
    return paths.sort();
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
    return (compiled.paramPaths[file] ?? []).map(bareName).sort();
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
        const paramPaths: Record<string, string[]> = {};
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
                    paramPaths[file] = paramPathsOf(generator);
                } else {
                    failures[file] = 'compile returned null';
                }
            } catch (error) {
                failures[file] = error instanceof Error ? error.message : String(error);
            }
        }
        compiled = { failures, paramPaths, moduleOf };
    }, COMPILE_TIMEOUT_MS);

    it('compiles every shipped .dsp except the documented known-broken set', () => {
        expect(Object.keys(compiled.failures).sort()).toEqual(KNOWN_BROKEN);
    });

    it('registers every shipped .dsp as a built-in', () => {
        const unregistered = Object.keys(compiled.paramPaths)
            .filter((file) => !compiled.moduleOf[file])
            .sort();
        expect(unregistered).toEqual([]);
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
            'threshold',
        ]);
    });

    it('stereo-widener.dsp compiles and exposes the params its descriptors declare', () => {
        // builtinDSP.ts declares /Stereo_Widener/{width,mono_bass}.
        expect(compiled.failures['stereo-widener.dsp']).toBeUndefined();
        expect(bareNamesOf('stereo-widener.dsp', compiled)).toEqual(['mono_bass', 'width']);
    });
});
