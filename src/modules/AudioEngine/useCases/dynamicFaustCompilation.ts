/**
 * Dynamic Faust Compilation.
 * In-browser Faust→WASM compilation for user-created plugins and live coding.
 *
 * Uses the Faust WASM compiler SDK loaded on demand.
 */

import { registerFaustDSP, compileFaustDSP, type FaustModule } from './faustEngine';

export type CompilationResult = {
    success: boolean;
    module: FaustModule | null;
    errors: string[];
    warnings: string[];
    compileTimeMs: number;
};

let compilerLoaded = false;

/**
 * Load the Faust compiler SDK.
 * In production, fetches faust2wasm.js from CDN or bundled.
 */
export async function loadFaustCompiler(): Promise<boolean> {
    if (compilerLoaded) {
        return true;
    }

    // Stub: In production, loads the Faust WASM compiler
    // await import('https://cdn.jsdelivr.net/npm/@AE/faust-compiler/faustwasm.min.js');
    console.info('[Faust Compiler] Loaded (stub)');
    compilerLoaded = true;
    return true;
}

/**
 * Compile user-provided Faust DSP code to a WASM module.
 */
export async function compileDSP(
    name: string,
    dspCode: string
): Promise<CompilationResult> {
    const startTime = performance.now();
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!compilerLoaded) {
        await loadFaustCompiler();
    }

    // Basic syntax validation
    if (!dspCode.includes('process')) {
        errors.push("Faust DSP must define a 'process' function");
        return { success: false, module: null, errors, warnings, compileTimeMs: performance.now() - startTime };
    }

    if (!dspCode.includes('import(')) {
        warnings.push("Consider importing 'stdfaust.lib' for standard library access");
    }

    // Register and compile
    const mod = registerFaustDSP(name, dspCode);
    const compiled = await compileFaustDSP(mod.id);

    return {
        success: compiled,
        module: compiled ? mod : null,
        errors: compiled ? [] : ['Compilation failed'],
        warnings,
        compileTimeMs: performance.now() - startTime,
    };
}

/**
 * Validate Faust DSP code without compiling.
 */
export function validateDSPCode(code: string): { valid: boolean; issues: string[] } {
    const issues: string[] = [];

    if (!code.trim()) {
        issues.push('Empty DSP code');
    }
    if (!code.includes('process')) {
        issues.push("Missing 'process' definition");
    }

    // Check for common issues
    const openParens = (code.match(/\(/g) ?? []).length;
    const closeParens = (code.match(/\)/g) ?? []).length;
    if (openParens !== closeParens) {
        issues.push(`Unbalanced parentheses: ${openParens} open, ${closeParens} close`);
    }

    return { valid: issues.length === 0, issues };
}

/**
 * Check if the Faust compiler is available.
 */
export function isCompilerAvailable(): boolean {
    return compilerLoaded;
}
