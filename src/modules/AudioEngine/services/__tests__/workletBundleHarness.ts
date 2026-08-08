import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { build, loadConfigFromFile } from 'vite';

import type { UserConfig } from 'vite';

/**
 * Evaluate an AudioWorklet processor from the **bundled artifact the app loads**,
 * not from its source text.
 *
 * ## Why this exists
 *
 * The previous harness read a processor's `.ts`, transpiled it, deleted its
 * module graph with `transpiled.replaceAll(/^import\s+.*?;$/gm, '')`, and ran the
 * remainder through `new Function` with every stripped symbol hand-supplied as a
 * parameter. That harness could not see module scope at all, so it broke three
 * separate times on imports that were correct in production:
 *
 *   1. `WasmView`                       — added to the injection list
 *   2. `resolveProcessorWasmModule`     — added to the injection list
 *   3. `FERMENTER_AUTOMATION_PARAM_IDS` — PR #1398 moved the ordinal table into
 *      `models/` so the worklet could *derive* its automation bound instead of
 *      restating it; `main` went red with
 *      `ReferenceError: FERMENTER_AUTOMATION_PARAM_IDS is not defined`, and
 *      PR #1399 extended the injection list again.
 *
 * The expensive part was never the fix — it was the diagnosis. A missing
 * *injected global* raises exactly the `ReferenceError` a genuinely missing
 * *binding in the worklet* would raise, so the failure pointed at production code
 * that was correct. Two lanes spent a reproduction on it and it came close to
 * being "fixed" in the processor; one lane settled it only by running
 * `pnpm build` and reading the shipped artifact.
 *
 * ## What this does instead
 *
 * `engine/FermenterNode.ts` loads its processor as
 * `import fermenterProcessorUrl from '../services/fermenterProcessor.ts?worker&url'`,
 * and `vite.config.ts` pins `worker.format: 'iife'` so each processor is bundled
 * into one self-contained script — a shared ES chunk cannot be resolved from the
 * blob URL context `AudioWorklet.addModule()` runs in.
 *
 * This harness drives that same `?worker&url` pipeline through Vite's
 * programmatic `build()` and evaluates the emitted asset:
 *
 *  - **No injection list.** Imports resolve the way they resolve in the browser,
 *    so adding an import to a processor needs no change here.
 *  - **Real class capture.** The constructor comes back through
 *    `registerProcessor`, which is how the browser obtains it, instead of being
 *    spliced out of mutilated source with `return SomeClassName;`.
 *  - **Shipping settings.** `worker` and `resolve` are read out of the project's
 *    own `vite.config.ts` rather than restated here, so the artifact is produced
 *    with the options that ship instead of a second set that could drift.
 *
 * What it does **not** prove: measured on Vite 8 / Rolldown, flipping
 * `worker.format` from `'iife'` to `'es'` still emits one self-contained script
 * per worker entry even when five processors are built together — each worker is
 * its own sub-build, so there is nothing for them to share a chunk with. This
 * harness therefore cannot red on a `worker.format` regression; the assertion
 * below that exactly one asset comes back is a precondition guard against a
 * future build that *does* split, not a live check of that setting.
 *
 * Cost: one config load (~0.7 s, once per test process) plus ~10-25 ms per
 * distinct processor entry. Bundles are cached per entry; each load re-evaluates
 * the cached artifact in a fresh scope, so callers get independent module state.
 */

const HARNESS_DIR = path.dirname(fileURLToPath(import.meta.url));
// src/modules/AudioEngine/services/__tests__ -> repository root
const PROJECT_ROOT = path.resolve(HARNESS_DIR, '../../../../..');
const PROCESSOR_DIR = path.resolve(HARNESS_DIR, '..');
const VIRTUAL_ENTRY_ID = 'sourdaw:worklet-bundle-entry';
const RESOLVED_VIRTUAL_ENTRY_ID = '\0sourdaw:worklet-bundle-entry';

/** The `port` surface `AudioWorkletProcessor` gives every processor instance. */
type WorkletPort = {
    onmessage: ((event: { data: unknown }) => void) | null;
    postMessage: (message: unknown) => void;
};

/** A processor class as `registerProcessor` receives it. */
export type WorkletProcessorConstructor<TProcessor> = new () => TProcessor;

type LoadedViteSettings = Pick<UserConfig, 'worker' | 'resolve'>;

let viteSettingsPromise: Promise<LoadedViteSettings> | undefined;

async function loadShippingViteSettings(): Promise<LoadedViteSettings> {
    const configPath = path.join(PROJECT_ROOT, 'vite.config.ts');
    const loaded = await loadConfigFromFile({ command: 'build', mode: 'production' }, configPath, PROJECT_ROOT);
    if (!loaded) {
        throw new Error(`workletBundleHarness: could not load ${configPath}`);
    }
    return { worker: loaded.config.worker, resolve: loaded.config.resolve };
}

const bundleCache = new Map<string, Promise<string>>();

// Vite does not re-export Rollup's `OutputChunk` / `OutputAsset` by those names,
// so the emitted-item type is derived from `build()`'s own return type. That also
// means it tracks the installed Vite rather than a hand-copied shape.
type BuildResult = Awaited<ReturnType<typeof build>>;
type BundleWithOutput = Extract<BuildResult, { output: readonly unknown[] }>;
type EmittedItem = BundleWithOutput['output'][number];

function collectOutputs(result: BuildResult): EmittedItem[] {
    const bundles = Array.isArray(result) ? result : [result];
    const collected: EmittedItem[] = [];
    for (const bundle of bundles) {
        if ('output' in bundle) {
            collected.push(...bundle.output);
        }
    }
    return collected;
}

async function bundleProcessor(entryPath: string): Promise<string> {
    viteSettingsPromise ??= loadShippingViteSettings();
    const settings = await viteSettingsPromise;

    const result = await build({
        root: PROJECT_ROOT,
        // The project's own plugins (router codegen, React Compiler babel,
        // Tailwind) never touch a worklet and cost seconds to run. The settings
        // that decide the *artifact shape* — `worker.format` and the module
        // resolution aliases — are the ones read from vite.config.ts above.
        configFile: false,
        logLevel: 'error',
        worker: settings.worker,
        resolve: settings.resolve,
        plugins: [
            {
                name: 'sourdaw-worklet-bundle-entry',
                resolveId(id: string) {
                    if (id === VIRTUAL_ENTRY_ID) {
                        return RESOLVED_VIRTUAL_ENTRY_ID;
                    }
                    return null;
                },
                load(id: string) {
                    if (id === RESOLVED_VIRTUAL_ENTRY_ID) {
                        const workletImport = JSON.stringify(`${entryPath}?worker&url`);
                        return `import workletUrl from ${workletImport};\nexport default workletUrl;\n`;
                    }
                    return null;
                },
            },
        ],
        build: {
            write: false,
            minify: false,
            target: 'esnext',
            rollupOptions: { input: VIRTUAL_ENTRY_ID },
        },
    });

    const outputs = collectOutputs(result);
    const entryBaseName = path.basename(entryPath, path.extname(entryPath));
    const workletAssets: Extract<EmittedItem, { type: 'asset' }>[] = [];
    for (const item of outputs) {
        if (item.type === 'asset' && path.basename(item.fileName).startsWith(entryBaseName)) {
            workletAssets.push(item);
        }
    }

    if (workletAssets.length !== 1) {
        const emitted = outputs.map((item) => item.fileName).join(', ');
        throw new Error(
            `workletBundleHarness: expected exactly one self-contained worklet asset for ${entryBaseName}, got ` +
                `${workletAssets.length} (emitted: ${emitted}). A worker build that splits into chunks cannot be ` +
                `loaded by AudioWorklet.addModule().`
        );
    }

    const source = workletAssets[0]!.source;
    if (typeof source === 'string') {
        return source;
    }
    return new TextDecoder().decode(source);
}

export type LoadWorkletProcessorInput = {
    /** File name of the processor entry inside `AudioEngine/services/`, e.g. `fermenterProcessor.ts`. */
    entryFileName: string;
    /** The name the processor passes to `registerProcessor`, e.g. `fermenter-processor`. */
    registeredName: string;
};

/**
 * Bundle a processor exactly as the app does and return the constructor it hands
 * to `registerProcessor`.
 */
export async function loadWorkletProcessor<TProcessor>({
    entryFileName,
    registeredName,
}: LoadWorkletProcessorInput): Promise<WorkletProcessorConstructor<TProcessor>> {
    const entryPath = path.resolve(PROCESSOR_DIR, entryFileName);
    let cached = bundleCache.get(entryPath);
    if (!cached) {
        cached = bundleProcessor(entryPath);
        bundleCache.set(entryPath, cached);
    }
    const code = await cached;

    const registry = new Map<string, WorkletProcessorConstructor<TProcessor>>();
    // Exactly the globals an AudioWorkletGlobalScope provides. Anything else a
    // processor references must arrive through its own imports — that is the
    // whole point of evaluating the bundle instead of the source.
    const hostGlobals = {
        AudioWorkletProcessor: class {
            port: WorkletPort = {
                onmessage: null,
                postMessage: () => {},
            };
        },
        registerProcessor: (name: string, processorCtor: WorkletProcessorConstructor<TProcessor>) => {
            registry.set(name, processorCtor);
        },
        sampleRate: 48_000,
        currentFrame: 0,
        currentTime: 0,
    };

    // eslint-disable-next-line @typescript-eslint/no-implied-eval -- test utility: evaluates the project's own bundled worklet artifact inside an AudioWorkletGlobalScope stand-in; no user input
    const evaluate = new Function(...Object.keys(hostGlobals), code);
    evaluate(...Object.values(hostGlobals));

    const registered = registry.get(registeredName);
    if (!registered) {
        throw new Error(
            `workletBundleHarness: ${entryFileName} did not registerProcessor(${JSON.stringify(registeredName)}); ` +
                `registered names were [${[...registry.keys()].join(', ')}]`
        );
    }
    return registered;
}
