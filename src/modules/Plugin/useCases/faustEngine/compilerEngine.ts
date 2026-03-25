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
import { registerWAMPlugin, type WAMDescriptor } from '../wamPluginHost';
import { type FaustModule, type FaustParamDescriptor } from '#/modules/Plugin/models/FaustEngineTypes';

// Module registry (raw Map singleton)
const modules = new Map<string, FaustModule>();

// Compiler singleton (lazy init)
let compilerPromise: Promise<IFaustCompiler> | null = null;
let compilerReady = false;

async function getCompiler(): Promise<IFaustCompiler> {
    if (!compilerPromise) {
        compilerPromise = (async () => {
            const module = await instantiateFaustModuleFromFile('/faust/libfaust-wasm.js');
            const libFaust = new LibFaust(module);
            const compiler = new FaustCompiler(libFaust);
            compilerReady = true;
            console.info(`[Faust] Compiler ready — version ${compiler.version()}`);
            return compiler;
        })();
    }
    return compilerPromise;
}

export function isFaustCompilerReady(): boolean {
    return compilerReady;
}

export function registerFaustDSP(name: string, dspCode: string, params: FaustParamDescriptor[] = [], isInstrument = false): FaustModule {
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
        vendor: 'Faust/WebDAW',
        version: '1.0',
        category: isInstrument ? 'instrument' : 'effect',
        sdkVersion: '2.0',
        keywords: ['faust', 'dsp'],
    };
    registerWAMPlugin(descriptor);

    return mod;
}

export async function compileFaustDSP(moduleId: string): Promise<boolean> {
    const mod = modules.get(moduleId);
    if (!mod) {
        console.warn(`[Faust] Module ${moduleId} not found`);
        return false;
    }
    if (mod.compiled && mod.generator) { return true; }

    try {
        const compiler = await getCompiler();
        const generator = new FaustMonoDspGenerator();
        const result = await generator.compile(
            compiler,
            mod.name.replaceAll(/\s+/g, '_'),
            mod.dspCode,
            '-I libraries/'
        );
        if (!result) {
            console.error(`[Faust] Compilation failed for ${mod.name}`);
            return false;
        }
        mod.generator = generator;
        mod.compiled = true;
        modules.set(moduleId, mod);
        console.info(`[Faust] Compiled ${mod.name}`);
        return true;
    } catch (error) {
        console.error(`[Faust] Compilation error for ${mod.name}:`, error);
        return false;
    }
}

export async function compileAllFaustModules(): Promise<number> {
    let compiled = 0;
    for (const [id, mod] of modules) {
        if (mod.compiled) { compiled++; continue; }
        const success = await compileFaustDSP(id);
        if (success) { compiled++; }
    }
    return compiled;
}

export async function createFaustNode(
    moduleId: string,
    context: BaseAudioContext
): Promise<IFaustMonoWebAudioNode | null> {
    const mod = modules.get(moduleId);
    if (!mod?.generator || !mod.compiled) {
        console.warn(`[Faust] Module ${moduleId} not compiled — call compileFaustDSP first`);
        return null;
    }
    try {
        return await mod.generator.createNode(context);
    } catch (error) {
        console.error(`[Faust] Node creation failed for ${mod.name}:`, error);
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
