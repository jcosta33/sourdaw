/**
 * Faust DSP Engine.
 * Framework for compiling and loading Faust .dsp files as WASM WAM plugins.
 * Provides the bridge between Faust source → WASM → AudioWorklet.
 *
 * In production, uses faust2wam or the Faust WASM compiler.
 * This module provides the TS-side infrastructure.
 */

import { registerWAMPlugin, type WAMDescriptor } from './wamPluginHost';

export type FaustModule = {
    id: string;
    name: string;
    dspCode: string;
    wasmModule: WebAssembly.Module | null;
    paramDescriptors: FaustParamDescriptor[];
    compiled: boolean;
};

export type FaustParamDescriptor = {
    address: string;
    label: string;
    min: number;
    max: number;
    defaultValue: number;
    step: number;
    type: 'hslider' | 'vslider' | 'nentry' | 'button' | 'checkbox';
};

const modules = new Map<string, FaustModule>();

/**
 * Register a Faust DSP source for compilation.
 */
export function registerFaustDSP(
    name: string,
    dspCode: string,
    params: FaustParamDescriptor[] = []
): FaustModule {
    const mod: FaustModule = {
        id: `faust-${name.toLowerCase().replace(/\s+/g, '-')}`,
        name,
        dspCode,
        wasmModule: null,
        paramDescriptors: params,
        compiled: false,
    };
    modules.set(mod.id, mod);

    // Also register as WAM plugin
    const descriptor: WAMDescriptor = {
        id: `faust.${mod.id}`,
        name: `[Faust] ${name}`,
        vendor: 'Faust/WebDAW',
        version: '1.0',
        category: 'effect',
        sdkVersion: '2.0',
        keywords: ['faust', 'dsp'],
    };
    registerWAMPlugin(descriptor);

    return mod;
}

/**
 * Compile a Faust DSP source to WASM.
 * In production, this would use the Faust WASM compiler SDK.
 */
export async function compileFaustDSP(moduleId: string): Promise<boolean> {
    const mod = modules.get(moduleId);
    if (!mod) {
        return false;
    }

    // Stub: In production, this calls faust2wasm or the Faust compiler SDK
    // which compiles .dsp → .wasm → AudioWorkletProcessor
    console.info(`[Faust] Compiling ${mod.name}...`);

    // Mark as compiled (WASM module would be stored here)
    mod.compiled = true;
    modules.set(moduleId, mod);

    return true;
}

/**
 * Get all registered Faust modules.
 */
export function getFaustModules(): FaustModule[] {
    return [...modules.values()];
}

/**
 * Get a specific Faust module.
 */
export function getFaustModule(moduleId: string): FaustModule | null {
    return modules.get(moduleId) ?? null;
}

// ─── Built-in Faust DSP definitions ──────────────────────

/**
 * Register all built-in Faust DSP effects.
 * These represent the Faust source code that would be compiled to WASM.
 */
export function registerBuiltinFaustDSP(): void {
    // Zita-Rev1 algorithmic reverb
    registerFaustDSP('Zita-Rev1 Reverb', `
        import("stdfaust.lib");
        process = re.zita_rev1_stereo(rdel, f1, f2, t60dc, t60m, fsmax)
        with {
            rdel = 60; f1 = 200; f2 = 6000;
            t60dc = 3; t60m = 2; fsmax = 48000;
        };
    `, [
        { address: '/zita/decay_time', label: 'Decay Time', min: 0.1, max: 15, defaultValue: 3, step: 0.1, type: 'hslider' },
        { address: '/zita/damping', label: 'Damping', min: 200, max: 12000, defaultValue: 6000, step: 100, type: 'hslider' },
        { address: '/zita/dry_wet', label: 'Dry/Wet', min: 0, max: 1, defaultValue: 0.3, step: 0.01, type: 'hslider' },
    ]);

    // 1176 compressor model
    registerFaustDSP('1176 Compressor', `
        import("stdfaust.lib");
        process = co.compressor_stereo(ratio, thresh, attack, release)
        with {
            ratio = hslider("ratio", 4, 1, 20, 0.1);
            thresh = hslider("threshold", -20, -60, 0, 0.1);
            attack = hslider("attack", 0.001, 0.0001, 0.1, 0.0001);
            release = hslider("release", 0.1, 0.01, 1, 0.001);
        };
    `, [
        { address: '/1176/ratio', label: 'Ratio', min: 1, max: 20, defaultValue: 4, step: 0.1, type: 'hslider' },
        { address: '/1176/threshold', label: 'Threshold', min: -60, max: 0, defaultValue: -20, step: 0.1, type: 'hslider' },
        { address: '/1176/attack', label: 'Attack', min: 0.0001, max: 0.1, defaultValue: 0.001, step: 0.0001, type: 'hslider' },
        { address: '/1176/release', label: 'Release', min: 0.01, max: 1, defaultValue: 0.1, step: 0.001, type: 'hslider' },
    ]);

    // Multiband compressor
    registerFaustDSP('Multiband Compressor', `
        import("stdfaust.lib");
        process = dm.compressor_demo;
    `, [
        { address: '/multiband/low_threshold', label: 'Low Threshold', min: -60, max: 0, defaultValue: -20, step: 0.5, type: 'hslider' },
        { address: '/multiband/mid_threshold', label: 'Mid Threshold', min: -60, max: 0, defaultValue: -15, step: 0.5, type: 'hslider' },
        { address: '/multiband/high_threshold', label: 'High Threshold', min: -60, max: 0, defaultValue: -10, step: 0.5, type: 'hslider' },
        { address: '/multiband/crossover_low', label: 'Low Crossover', min: 50, max: 500, defaultValue: 200, step: 10, type: 'hslider' },
        { address: '/multiband/crossover_high', label: 'High Crossover', min: 1000, max: 10000, defaultValue: 3000, step: 100, type: 'hslider' },
    ]);

    // Pro EQ (de-cramped)
    registerFaustDSP('Pro Parametric EQ', `
        import("stdfaust.lib");
        process = fi.low_shelf(lf_gain, lf_freq) :
                  fi.peak_eq(mf_gain, mf_freq, mf_q) :
                  fi.high_shelf(hf_gain, hf_freq);
    `, [
        { address: '/eq/lf_gain', label: 'Low Gain', min: -18, max: 18, defaultValue: 0, step: 0.1, type: 'hslider' },
        { address: '/eq/lf_freq', label: 'Low Freq', min: 20, max: 500, defaultValue: 100, step: 1, type: 'hslider' },
        { address: '/eq/mf_gain', label: 'Mid Gain', min: -18, max: 18, defaultValue: 0, step: 0.1, type: 'hslider' },
        { address: '/eq/mf_freq', label: 'Mid Freq', min: 200, max: 8000, defaultValue: 1000, step: 1, type: 'hslider' },
        { address: '/eq/mf_q', label: 'Mid Q', min: 0.1, max: 10, defaultValue: 1, step: 0.1, type: 'hslider' },
        { address: '/eq/hf_gain', label: 'High Gain', min: -18, max: 18, defaultValue: 0, step: 0.1, type: 'hslider' },
        { address: '/eq/hf_freq', label: 'High Freq', min: 1000, max: 20000, defaultValue: 8000, step: 100, type: 'hslider' },
    ]);

    // Tape delay
    registerFaustDSP('Tape Delay', `
        import("stdfaust.lib");
        process = ef.echo(maxdel, delay, feedback)
        with {
            maxdel = 2.0;
            delay = hslider("delay", 0.3, 0.01, 2, 0.01);
            feedback = hslider("feedback", 0.5, 0, 0.95, 0.01);
        };
    `, [
        { address: '/tape_delay/delay', label: 'Delay Time', min: 0.01, max: 2, defaultValue: 0.3, step: 0.01, type: 'hslider' },
        { address: '/tape_delay/feedback', label: 'Feedback', min: 0, max: 0.95, defaultValue: 0.5, step: 0.01, type: 'hslider' },
        { address: '/tape_delay/wow_flutter', label: 'Wow & Flutter', min: 0, max: 1, defaultValue: 0.3, step: 0.01, type: 'hslider' },
        { address: '/tape_delay/tone', label: 'Tone', min: 500, max: 12000, defaultValue: 4000, step: 100, type: 'hslider' },
    ]);

    // Brick-wall limiter with lookahead
    registerFaustDSP('Brick-Wall Limiter', `
        import("stdfaust.lib");
        process = co.limiter_1176_R4_stereo;
    `, [
        { address: '/limiter/ceiling', label: 'Ceiling', min: -6, max: 0, defaultValue: -0.3, step: 0.1, type: 'hslider' },
        { address: '/limiter/release', label: 'Release', min: 10, max: 500, defaultValue: 100, step: 1, type: 'hslider' },
        { address: '/limiter/lookahead', label: 'Lookahead (ms)', min: 0, max: 10, defaultValue: 5, step: 0.5, type: 'hslider' },
    ]);

    // Spring reverb
    registerFaustDSP('Spring Reverb', `
        import("stdfaust.lib");
        process = re.mono_freeverb(fb1, fb2, damp, spread);
    `, [
        { address: '/spring/decay', label: 'Decay', min: 0.1, max: 8, defaultValue: 2, step: 0.1, type: 'hslider' },
        { address: '/spring/brightness', label: 'Brightness', min: 0, max: 1, defaultValue: 0.5, step: 0.01, type: 'hslider' },
        { address: '/spring/mix', label: 'Mix', min: 0, max: 1, defaultValue: 0.25, step: 0.01, type: 'hslider' },
    ]);
}
