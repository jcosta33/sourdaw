// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// The package's "main" CJS bundle exposes no runtime exports under Node SSR
// resolution; the ESM build (what Vite serves the app) does.
import {
    FaustCompiler,
    FaustMonoDspGenerator,
    instantiateFaustModuleFromFile,
    LibFaust,
    type IFaustCompiler,
} from '@grame/faustwasm/dist/esm/index.js';
import { describe, expect, it, beforeAll } from 'vitest';

/**
 * Compiles every shipped .dsp through the app's own Faust path
 * (compileFaustDSP.ts: libfaust wasm + '-I libraries/') so a built-in that
 * cannot compile — and would be silently skipped by faustDeviceFactory — fails
 * CI instead of shipping dead (audit #508 row 7: spring-reverb.dsp had four
 * undefined free identifiers while factory templates referenced the device).
 */

const DSP_DIR = 'src/modules/PluginHost/useCases/faustEngine/dsp';
const LIBFAUST_JS = './public/faust/libfaust-wasm.js';
const COMPILE_TIMEOUT_MS = 300_000;

/**
 * Documented known-broken shipped DSP, reported on the #508 ledger for their
 * own rows — exact and reviewable: a NEW compile failure fails this test, and
 * repairing one of these fails it too (remove the file from the set).
 * - de-esser.dsp / stereo-widener.dsp: sequential-composition arity errors
 * - noise-gate.dsp: undefined symbol `gate_stereo`
 */
const KNOWN_BROKEN = ['de-esser.dsp', 'noise-gate.dsp', 'stereo-widener.dsp'];

type CompiledDsp = {
    failures: Record<string, string>;
    paramPaths: Record<string, string[]>;
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

describe('shipped Faust DSP compile', () => {
    let compiler: IFaustCompiler;
    let compiled: CompiledDsp;

    beforeAll(async () => {
        const faustModule = await instantiateFaustModuleFromFile(LIBFAUST_JS);
        compiler = new FaustCompiler(new LibFaust(faustModule));

        const failures: Record<string, string> = {};
        const paramPaths: Record<string, string[]> = {};
        const files = readdirSync(DSP_DIR)
            .filter((name) => name.endsWith('.dsp'))
            .sort();
        for (const file of files) {
            const dspCode = readFileSync(join(DSP_DIR, file), 'utf8');
            const generator = new FaustMonoDspGenerator();
            try {
                const result = await generator.compile(compiler, file.replace(/\.dsp$/, ''), dspCode, '-I libraries/');
                if (result) {
                    paramPaths[file] = paramPathsOf(generator);
                } else {
                    failures[file] = 'compile returned null';
                }
            } catch (error) {
                failures[file] = error instanceof Error ? error.message : String(error);
            }
        }
        compiled = { failures, paramPaths };
    }, COMPILE_TIMEOUT_MS);

    it('compiles every shipped .dsp except the documented known-broken set', () => {
        expect(Object.keys(compiled.failures).sort()).toEqual(KNOWN_BROKEN);
    });

    it('spring-reverb.dsp compiles and exposes the params its descriptors declare', () => {
        // builtinDSP.ts declares /spring/decay, /spring/brightness, /spring/mix;
        // FaustEffectDescriptors.ts exposes all three in the device UI.
        expect(compiled.failures['spring-reverb.dsp']).toBeUndefined();
        expect(compiled.paramPaths['spring-reverb.dsp']).toEqual([
            '/spring/brightness',
            '/spring/decay',
            '/spring/mix',
        ]);
    });
});
