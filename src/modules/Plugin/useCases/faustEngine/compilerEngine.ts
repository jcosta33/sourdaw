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
    LibFaust,
    type IFaustCompiler,
    type IFaustMonoWebAudioNode,
} from '@grame/faustwasm';
import { createFaustError } from '#/modules/Plugin/errors/FaustError';
import { isAppError } from '#/infra/errors/isAppError';
import { registerWAMPlugin, type WAMDescriptor } from '../wamPluginHost/hostOperations';
import { type FaustModule, type FaustParamDescriptor } from '#/modules/Plugin/models/FaustEngineTypes';

// Module registry (raw Map singleton)
const modules = new Map<string, FaustModule>();

// Compilation promise cache to prevent concurrent compilations for the same module
const compilationPromises = new Map<string, Promise<boolean>>();

/**
 * Registration promise cache to prevent concurrent AudioWorklet registration
 * for the same module on the same AudioContext.
 * 
 * WeakMap<AudioContext, Map<moduleId, Promise<void>>>
 */
const registrationPromises = new WeakMap<BaseAudioContext, Map<string, Promise<void>>>();

// Compiler singleton (lazy init)
let compilerPromise: Promise<IFaustCompiler> | null = null;
let compilerReady = false;

let compilerError: string | null = null;

async function getCompiler(): Promise<IFaustCompiler> {
    if (!compilerPromise) {
        compilerPromise = (async () => {
            try {
                // Use origin-relative path so it works with any protocol
                // (http:// in dev, tauri:// or https://tauri.localhost in production)
                const faustPath = `${window.location.origin}/faust/libfaust-wasm.js`;

                const module = await instantiateFaustModuleFromFile(faustPath);
                const libFaust = new LibFaust(module);
                const compiler = new FaustCompiler(libFaust);
                compilerReady = true;
                return compiler;
            } catch (error) {
                const msg = isAppError(error) ? error.message : error instanceof Error ? error.message : String(error);
                compilerError = msg;
                console.error(`[Faust] Compiler initialization failed: ${msg}`);
                // Re-throw so callers know compilation is impossible
                throw createFaustError(`Faust compiler unavailable: ${msg}`);
            }
        })();
    }
    return compilerPromise;
}

/** Returns the compiler init error message, if any. */
export function getFaustCompilerError(): string | null {
    return compilerError;
}

export function isFaustCompilerReady(): boolean {
    return compilerReady;
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
        console.error(`[Faust] Module "${moduleId}" not registered. Available: ${[...modules.keys()].join(', ')}`);
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
            const generator = new FaustMonoDspGenerator();
            // Use sanitized name as processor name
            const processorName = mod.name.replaceAll(/\s+/g, '_');
            const result = await generator.compile(compiler, processorName, mod.dspCode, '-I libraries/');
            if (!result) {
                console.error(`[Faust] Compilation returned null for "${mod.name}". DSP code may have syntax errors.`);
                return false;
            }
            mod.generator = generator;
            mod.compiled = true;
            modules.set(moduleId, mod);
            return true;
        } catch (error) {
            const msg = isAppError(error) ? error.message : error instanceof Error ? error.message : String(error);
            console.error(`[Faust] Compilation failed for "${mod.name}": ${msg}`);
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
): Promise<IFaustMonoWebAudioNode | null> {
    const mod = modules.get(moduleId);
    if (!mod?.generator || !mod.compiled) {
        const reason = compilerError ? `Compiler unavailable: ${compilerError}` : 'Module not compiled';
        console.error(`[Faust] Cannot create node for "${moduleId}": ${reason}`);
        return null;
    }

    // Get or create the registration map for this context
    let contextRegistrations = registrationPromises.get(context);
    if (!contextRegistrations) {
        contextRegistrations = new Map();
        registrationPromises.set(context, contextRegistrations);
    }

    // Check if this module is already being registered in this context
    const existingReg = contextRegistrations.get(moduleId);
    if (existingReg) {
        await existingReg;
    }

    // We use a manual promise to track the registration phase of createNode
    let resolveReg: () => void;
    const regPromise = new Promise<void>((resolve) => {
        resolveReg = resolve;
    });

    // If no existing registration was in progress, we become the "primary" creator
    // that performs the registration. Subsequent concurrent calls will await regPromise.
    if (!existingReg) {
        contextRegistrations.set(moduleId, regPromise);
    }

    try {
        const node = await mod.generator.createNode(context);
        
        // Registration successful (or was already done)
        if (!existingReg) resolveReg!();
        
        return node;
    } catch (error) {
        const msg = isAppError(error) ? error.message : error instanceof Error ? error.message : String(error);

        // If the error is "already registered", it means we collided despite the cache
        // or faustwasm's internal state is out of sync. We can try to recover by 
        // assuming it's now registered and just trying again, but faustwasm's 
        // createNode is what performs both registration and node instantiation.
        
        if (msg.includes('already registered')) {
            // Signal that registration is "done" (even if it failed with "already registered")
            // so other waiters can try to create their nodes.
            if (!existingReg) resolveReg!();
            
            // Try one more time — if it was just a race, it might succeed now.
            try {
                return await mod.generator.createNode(context);
            } catch (retryError) {
                console.error(`[Faust] Node creation retry failed for "${mod.name}": ${retryError}`);
            }
        } else {
            // Real error, allow other waiters to fail too if they want
            if (!existingReg) resolveReg!();
        }

        console.error(`[Faust] Node creation failed for "${mod.name}": ${msg}`);
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
