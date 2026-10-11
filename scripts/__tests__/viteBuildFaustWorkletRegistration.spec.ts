// @vitest-environment node
import { resolveObjectURL } from 'node:buffer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import { build, loadConfigFromFile, type UserConfig } from 'vite';
import { describe, expect, it } from 'vitest';

/**
 * Faust devices create their AudioWorklet from source text that
 * `@grame/faustwasm` assembles at runtime: `var ${Cls.name} = ${Cls.toString()}`
 * plus aliases under the source names, then `addModule` on a Blob of that text.
 * The processor registers only when every identifier inside the stringified
 * classes is one that text declares, so the production minifier must keep
 * those names.
 *
 * This bundles faustwasm's generators with the build and minifier settings read
 * from `vite.config.ts`, drives each generator's `createNode` against a context
 * whose worklet evaluates the module text the way an AudioWorkletGlobalScope
 * does, and requires the processor to register under the name the node asks for.
 */

const SPEC_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SPEC_DIR, '../..');
const VIRTUAL_ENTRY_ID = 'sourdaw:faust-generators-entry';
const RESOLVED_VIRTUAL_ENTRY_ID = `\0${VIRTUAL_ENTRY_ID}`;

type ProbeFactory = { shaKey: string; json: string; code: Uint8Array; soundfiles: Record<string, never> };

type ProbeContext = {
    sampleRate: number;
    audioWorklet: { addModule: (url: string) => Promise<void> };
};

type MonoGenerator = {
    createNode: (context: ProbeContext, name: string, factory: ProbeFactory) => Promise<unknown>;
};

type PolyGenerator = {
    createNode: (
        context: ProbeContext,
        voices: number,
        name: string,
        voiceFactory: ProbeFactory,
        mixerModule: object
    ) => Promise<unknown>;
};

type BundledGenerators = {
    FaustMonoDspGenerator: new () => MonoGenerator;
    FaustPolyDspGenerator: new () => PolyGenerator;
};

type WorkletProbe = {
    context: ProbeContext;
    registeredNames: string[];
};

type GeneratorBundle = {
    entryFileName: string;
    chunkCode: ReadonlyMap<string, string>;
};

type CommonJsModule = { exports: Record<string, unknown> };

async function loadShippingConfig(): Promise<UserConfig> {
    const configPath = path.join(PROJECT_ROOT, 'vite.config.ts');
    const loaded = await loadConfigFromFile({ command: 'build', mode: 'production' }, configPath, PROJECT_ROOT);
    if (!loaded) {
        throw new Error(`could not load ${configPath}`);
    }
    return loaded.config;
}

/**
 * Bundle and minify the generators with the shipping `build`, `esbuild`, `oxc`,
 * and `resolve` settings. Only the entry and the output format differ: CommonJS
 * lets `node:vm` evaluate the chunks as scripts, and it mangles top-level names
 * as the ES chunks the app ships do.
 */
async function bundleGenerators(config: UserConfig): Promise<GeneratorBundle> {
    const shippingBuild = config.build ?? {};
    const shippingRolldown = shippingBuild.rolldownOptions ?? {};
    const shippingOutput = shippingRolldown.output ?? {};
    if (Array.isArray(shippingOutput)) {
        throw new TypeError('vite.config.ts build.rolldownOptions.output is an array; this spec expects one output');
    }

    const result = await build({
        root: PROJECT_ROOT,
        configFile: false,
        logLevel: 'error',
        resolve: config.resolve,
        esbuild: config.esbuild,
        oxc: config.oxc,
        plugins: [
            {
                name: 'sourdaw-faust-generators-entry',
                resolveId: (id: string) => (id === VIRTUAL_ENTRY_ID ? RESOLVED_VIRTUAL_ENTRY_ID : null),
                load: (id: string) =>
                    id === RESOLVED_VIRTUAL_ENTRY_ID
                        ? "export { FaustMonoDspGenerator, FaustPolyDspGenerator } from '@grame/faustwasm';\n"
                        : null,
            },
        ],
        build: {
            ...shippingBuild,
            write: false,
            rolldownOptions: {
                ...shippingRolldown,
                input: VIRTUAL_ENTRY_ID,
                preserveEntrySignatures: 'strict',
                output: { ...shippingOutput, format: 'cjs' },
            },
        },
    });

    const bundles = Array.isArray(result) ? result : [result];
    const chunks = bundles.flatMap((bundle) =>
        'output' in bundle ? bundle.output.filter((item) => item.type === 'chunk') : []
    );
    const entry = chunks.find((chunk) => chunk.isEntry);
    if (!entry) {
        throw new Error(`no entry chunk among ${chunks.map((chunk) => chunk.fileName).join(', ')}`);
    }
    return {
        entryFileName: entry.fileName,
        chunkCode: new Map(chunks.map((chunk) => [chunk.fileName, chunk.code])),
    };
}

function isBundledGenerators(value: unknown): value is BundledGenerators {
    return (
        typeof value === 'object' &&
        value !== null &&
        'FaustMonoDspGenerator' in value &&
        typeof value.FaustMonoDspGenerator === 'function' &&
        'FaustPolyDspGenerator' in value &&
        typeof value.FaustPolyDspGenerator === 'function'
    );
}

/** The main-thread side: a node can only be constructed for a registered name, as in Chromium. */
class ProbeAudioWorkletNode {
    readonly port = { postMessage: () => {}, addEventListener: () => {}, start: () => {} };

    constructor(context: { registeredNames: readonly string[] }, name: string) {
        if (!context.registeredNames.includes(name)) {
            throw new Error(`The node name '${name}' is not defined in AudioWorkletGlobalScope.`);
        }
    }
}

/** Evaluate the emitted CommonJS chunks in one main-thread realm, resolving chunk-relative requires. */
function evaluateBundle({ entryFileName, chunkCode }: GeneratorBundle): BundledGenerators {
    const realm = vm.createContext({ AudioWorkletNode: ProbeAudioWorkletNode, Blob, URL, console });
    const loaded = new Map<string, CommonJsModule>();

    const load = (fileName: string): CommonJsModule['exports'] => {
        const cached = loaded.get(fileName);
        if (cached) {
            return cached.exports;
        }
        const code = chunkCode.get(fileName);
        if (code === undefined) {
            throw new Error(`generator bundle required ${fileName}, which the build did not emit`);
        }
        const moduleRecord: CommonJsModule = { exports: {} };
        loaded.set(fileName, moduleRecord);
        const wrapper: unknown = vm.runInContext(`(function (exports, module, require) {\n${code}\n})`, realm, {
            filename: fileName,
        });
        if (typeof wrapper !== 'function') {
            throw new TypeError(`${fileName} did not evaluate to a module wrapper`);
        }
        const requireChunk = (id: string) => load(path.posix.join(path.posix.dirname(fileName), id));
        wrapper(moduleRecord.exports, moduleRecord, requireChunk);
        return moduleRecord.exports;
    };

    const exported = load(entryFileName);
    if (!isBundledGenerators(exported)) {
        throw new Error(`bundle exported [${Object.keys(exported).join(', ')}]`);
    }
    return exported;
}

async function readBlobUrl(url: string): Promise<string> {
    const blob = resolveObjectURL(url);
    if (!blob) {
        throw new Error(`addModule received an unresolvable URL ${url}`);
    }
    URL.revokeObjectURL(url);
    return blob.text();
}

function evaluateWorkletModule(source: string, scope: vm.Context): void {
    try {
        vm.runInContext(source, scope, { filename: 'faust-worklet-module.js' });
    } catch (error) {
        // The error comes from the worklet realm, so `instanceof Error` cannot recognise it.
        throw new Error(`the generated worklet module threw while evaluating: ${String(error)}`, { cause: error });
    }
}

/**
 * A context whose `addModule` evaluates the module text in its own
 * AudioWorkletGlobalScope stand-in and rejects when that evaluation throws.
 * `registerProcessor` reads `parameterDescriptors`, as the browser does at
 * registration.
 */
function createWorkletProbe(): WorkletProbe {
    const registeredNames: string[] = [];
    const scope = vm.createContext({
        AudioWorkletProcessor: class {},
        sampleRate: 48_000,
        currentFrame: 0,
        currentTime: 0,
        registerProcessor: (name: string, processor: { parameterDescriptors?: unknown }) => {
            void processor.parameterDescriptors;
            registeredNames.push(name);
        },
    });
    const context = {
        sampleRate: 48_000,
        registeredNames,
        audioWorklet: {
            addModule: async (url: string) => {
                evaluateWorkletModule(await readBlobUrl(url), scope);
            },
        },
    };
    return { context, registeredNames };
}

function probeFactory(shaKey: string): ProbeFactory {
    const json = JSON.stringify({
        name: 'probe',
        compile_options: '-lang wasm-i -single -ftz 2',
        inputs: 0,
        outputs: 1,
        meta: [],
        ui: [
            {
                type: 'vgroup',
                label: 'probe',
                items: [
                    {
                        type: 'hslider',
                        label: 'level',
                        shortname: 'level',
                        address: '/probe/level',
                        index: 0,
                        init: 0.5,
                        min: 0,
                        max: 1,
                        step: 0.01,
                    },
                ],
            },
        ],
    });
    return { shaKey, json, code: new Uint8Array(), soundfiles: {} };
}

describe('production build keeps Faust worklet processors registrable', () => {
    it('registers the mono and poly processors faustwasm builds from a minified bundle', async () => {
        const generators = evaluateBundle(await bundleGenerators(await loadShippingConfig()));

        const mono = createWorkletProbe();
        const monoNode = await new generators.FaustMonoDspGenerator().createNode(
            mono.context,
            'probe',
            probeFactory('probe-mono')
        );

        const poly = createWorkletProbe();
        const polyNode = await new generators.FaustPolyDspGenerator().createNode(
            poly.context,
            2,
            'probe',
            probeFactory('probe-poly'),
            {}
        );

        expect(mono.registeredNames).toEqual(['probe-mono']);
        expect(monoNode).toBeInstanceOf(ProbeAudioWorkletNode);
        expect(poly.registeredNames).toEqual(['probe-poly']);
        expect(polyNode).toBeInstanceOf(ProbeAudioWorkletNode);
    }, 60_000);
});
