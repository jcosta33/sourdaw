/**
 * Faust DSP Engine — core compiler and node creation.
 *
 * Compiles Faust DSP code to WASM at runtime using @grame/faustwasm,
 * producing AudioWorkletNodes for the Web Audio graph.
 *
 * Flow: DSP source → FaustCompiler → FaustMonoDspGenerator → AudioWorkletNode
 *
 * The compiler + WASM module (~15MB) is loaded lazily on first use.
 * Compiled factories are cached by the FaustCompiler (SHA256-based).
 */

import {
    instantiateFaustModuleFromFile,
    FaustCompiler,
    FaustMonoDspGenerator,
    FaustPolyDspGenerator,
    LibFaust,
    type IFaustCompiler,
    type IFaustMonoWebAudioNode,
    type IFaustPolyWebAudioNode,
} from '@grame/faustwasm';

import { isAppError } from '#/infra/errors/isAppError';
import { logger } from '#/infra/logger/appLogger';

import { createFaustError } from '../../errors/FaustError';
import { type FaustModule, type FaustParamDescriptor } from '../../models/FaustEngineTypes';
import { registerPluginLoader } from '../../services/pluginLoaderRegistry';
import { type WAMDescriptor } from '../wamPluginHost/hostOperations/helpers';
import { registerWAMPlugin } from '../wamPluginHost/hostOperations/registerWAMPlugin';

/**
 * Default voice count for polyphonic Faust instruments. 8 covers typical keyboard
 * chord + sustain; per-instrument overrides could be threaded through if a preset
 * needs more.
 */
const POLY_VOICES_DEFAULT = 8;

// Module registry (raw Map singleton)
const modules = new Map<string, FaustModule>();

// Compilation promise cache to prevent concurrent compilations for the same module
const compilationPromises = new Map<string, Promise<boolean>>();

/**
 * Per-context serialization lock. Every `createNode` call on a given
 * context chains onto this promise so no two faustwasm calls can interleave
 * their internal `audioWorklet.addModule` + `new AudioWorkletNode(shaKey)`
 * steps — the previous per-moduleId lock didn't help when two different
 * modules compiled to different shaKeys but shared faustwasm's internal
 * `gWorkletProcessors` registry, letting a later `new AudioWorkletNode`
 * fire before the earlier `addModule`'s worklet-scope evaluation finished.
 */
const contextCreateLock = new WeakMap<BaseAudioContext, Promise<unknown>>();

// Compiler singleton (lazy init). §128.1 — coalesced into a single holder
// so the module-level bindings can't be reassigned from outside this file.
const compilerState: {
    promise: Promise<IFaustCompiler> | null;
    ready: boolean;
    error: string | null;
} = {
    promise: null,
    ready: false,
    error: null,
};

async function getCompiler(): Promise<IFaustCompiler> {
    if (!compilerState.promise) {
        compilerState.promise = (async () => {
            try {
                // Use origin-relative path so it works with any protocol
                // (http:// in dev, tauri:// or https://tauri.localhost in production)
                const faustPath = `${window.location.origin}/faust/libfaust-wasm.js`;

                const module = await instantiateFaustModuleFromFile(faustPath);
                const libFaust = new LibFaust(module);
                const compiler = new FaustCompiler(libFaust);
                compilerState.ready = true;
                return compiler;
            } catch (error) {
                let msg: string;
                if (isAppError(error)) {
                    msg = error.message;
                } else if (error instanceof Error) {
                    msg = error.message;
                } else {
                    msg = String(error);
                }
                compilerState.error = msg;
                logger.warn(`[Faust] Compiler initialization failed: ${msg}`);
                // Re-throw so callers know compilation is impossible
                throw createFaustError(`Faust compiler unavailable: ${msg}`);
            }
        })();
    }
    return compilerState.promise;
}

/** Returns the compiler init error message, if any. */
export function getFaustCompilerError(): string | null {
    return compilerState.error;
}

export function isFaustCompilerReady(): boolean {
    return compilerState.ready;
}

export function registerFaustDSP(
    name: string,
    dspCode: string,
    params: FaustParamDescriptor[] = [],
    isInstrument = false
): FaustModule {
    const mod: FaustModule = {
        id: `faust-${name.toLowerCase().replaceAll(/\s+/g, '-')}`,
        name,
        dspCode,
        paramDescriptors: params,
        compiled: false,
        isInstrument,
        generator: null,
    };
    modules.set(mod.id, mod);

    const descriptor: WAMDescriptor = {
        id: `faust.${mod.id}`,
        name: `[Faust] ${name}`,
        vendor: 'Faust/Sourdaw',
        version: '1.0',
        category: isInstrument ? 'instrument' : 'effect',
        sdkVersion: '2.0',
        keywords: ['faust', 'dsp'],
    };
    registerWAMPlugin(descriptor);

    return mod;
}

/**
 * Compiles a Faust module to WASM.
 * Uses a promise cache to ensure concurrent requests for the same module
 * share the same compilation process and resulting generator.
 */
export async function compileFaustDSP(moduleId: string): Promise<boolean> {
    const mod = modules.get(moduleId);
    if (!mod) {
        logger.warn(`[Faust] Module "${moduleId}" not registered. Available: ${[...modules.keys()].join(', ')}`);
        return false;
    }
    if (mod.compiled && mod.generator) {
        return true;
    }

    // Return existing promise if compilation is already in progress
    const existingPromise = compilationPromises.get(moduleId);
    if (existingPromise) {
        return existingPromise;
    }

    const promise = (async () => {
        try {
            const compiler = await getCompiler();
            const generator = mod.isInstrument ? new FaustPolyDspGenerator() : new FaustMonoDspGenerator();
            // Use sanitized name as processor name
            const processorName = mod.name.replaceAll(/\s+/g, '_');
            const result = await generator.compile(compiler, processorName, mod.dspCode, '-I libraries/');
            if (!result) {
                logger.warn(`[Faust] Compilation returned null for "${mod.name}". DSP code may have syntax errors.`);
                return false;
            }
            mod.generator = generator;
            mod.compiled = true;
            modules.set(moduleId, mod);
            return true;
        } catch (error) {
            let msg: string;
            if (isAppError(error)) {
                msg = error.message;
            } else if (error instanceof Error) {
                msg = error.message;
            } else {
                msg = String(error);
            }
            logger.warn(`[Faust] Compilation failed for "${mod.name}": ${msg}`);
            return false;
        } finally {
            compilationPromises.delete(moduleId);
        }
    })();

    compilationPromises.set(moduleId, promise);
    return promise;
}

/**
 * Compiles all registered Faust modules.
 */
export async function compileAllFaustModules(): Promise<number> {
    const results = await Promise.all([...modules.keys()].map((id) => compileFaustDSP(id)));
    return results.filter(Boolean).length;
}

/**
 * Creates an AudioWorkletNode from a compiled Faust module.
 *
 * Uses a WeakMap-based promise cache to ensure that AudioWorklet registration
 * (which happens inside generator.createNode) is serialized per context and module.
 */
export async function createFaustNode(
    moduleId: string,
    context: BaseAudioContext
): Promise<IFaustMonoWebAudioNode | IFaustPolyWebAudioNode | null> {
    const mod = modules.get(moduleId);
    if (!mod?.generator || !mod.compiled) {
        const reason = compilerState.error ? `Compiler unavailable: ${compilerState.error}` : 'Module not compiled';
        logger.warn(`[Faust] Cannot create node for "${moduleId}": ${reason}`);
        return null;
    }

    const previous = contextCreateLock.get(context) ?? Promise.resolve();
    const self = previous.then(() => attemptCreateNode(mod, context));
    contextCreateLock.set(
        context,
        self.catch(() => {})
    );
    return self;
}

async function attemptCreateNode(
    mod: FaustModule,
    context: BaseAudioContext
): Promise<IFaustMonoWebAudioNode | IFaustPolyWebAudioNode | null> {
    const generator = mod.generator;
    if (!generator) {
        return null;
    }
    const invoke = () =>
        generator instanceof FaustPolyDspGenerator
            ? generator.createNode(context, POLY_VOICES_DEFAULT)
            : generator.createNode(context);
    try {
        return await invoke();
    } catch (error) {
        let msg: string;
        if (isAppError(error)) {
            msg = error.message;
        } else if (error instanceof Error) {
            msg = error.message;
        } else {
            msg = String(error);
        }

        if (msg.includes('already registered')) {
            try {
                return await invoke();
            } catch (retryError) {
                logger.warn(`[Faust] Node creation retry failed for "${mod.name}":`, retryError);
            }
        } else if (msg.includes('is not defined in AudioWorkletGlobalScope')) {
            let backoff = 20;
            const maxRetries = 5;
            for (let i = 0; i < maxRetries; i++) {
                await new Promise<void>((resolve) => setTimeout(resolve, backoff));
                try {
                    return await invoke();
                } catch (retryError) {
                    if (i === maxRetries - 1) {
                        logger.warn(`[Faust] Node creation retry failed for "${mod.name}":`, retryError);
                    } else {
                        backoff *= 2;
                    }
                }
            }
        }

        logger.warn(`[Faust] Node creation failed for "${mod.name}": ${msg}`);
        return null;
    }
}

export function getFaustModules(): FaustModule[] {
    return [...modules.values()];
}

export function getFaustModule(moduleId: string): FaustModule | null {
    return modules.get(moduleId) ?? null;
}

export function isFaustModule(moduleId: string): boolean {
    return modules.has(moduleId);
}

export type { FaustModule, FaustParamDescriptor };

// ── Plugin loader registration ─────────────────────────────────────────────
//
// Register the Faust loader against the format-agnostic
// `pluginLoaderRegistry` at module init. This inverts the dependency: the
// WAM host no longer imports compilerEngine to load `faust.*` plugins —
// it consults the registry instead. Side-effect at module load is required
// because nothing imports the registry directly from the host side.

registerPluginLoader('faust.', async (pluginId, context) => {
    const faustModuleId = pluginId.replace('faust.', '');
    const compiled = await compileFaustDSP(faustModuleId);
    if (!compiled) {
        return null;
    }
    const faustNode = await createFaustNode(faustModuleId, context);
    return faustNode;
});
