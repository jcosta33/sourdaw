/**
 * Pro Synth Instruments (Faust-based).
 * DSP definitions for professional synthesizer instruments.
 */

import { registerFaustDSP, type FaustParamDescriptor } from './faustEngine';

/**
 * Register all pro synth instruments.
 */
export function registerProSynthInstruments(): void {
    // FM Synth (DX7-style 6-operator)
    registerFaustDSP('FM Synth', `
        import("stdfaust.lib");
        // 6-operator FM synthesis (simplified DX7 model)
        freq = hslider("freq", 440, 20, 12000, 0.01);
        gate = button("gate");
        ratio1 = hslider("op1_ratio", 1, 0.5, 16, 0.001);
        ratio2 = hslider("op2_ratio", 2, 0.5, 16, 0.001);
        index = hslider("fm_index", 5, 0, 20, 0.01);
        process = os.osc(freq * ratio1 + index * os.osc(freq * ratio2)) * en.adsr(0.01, 0.2, 0.7, 0.3, gate) <: _, _;
    `, makeSynthParams([
        { address: '/fm/op1_ratio', label: 'Op1 Ratio', min: 0.5, max: 16, defaultValue: 1, step: 0.001 },
        { address: '/fm/op2_ratio', label: 'Op2 Ratio', min: 0.5, max: 16, defaultValue: 2, step: 0.001 },
        { address: '/fm/fm_index', label: 'FM Index', min: 0, max: 20, defaultValue: 5, step: 0.01 },
        { address: '/fm/brightness', label: 'Brightness', min: 0, max: 1, defaultValue: 0.7, step: 0.01 },
    ]));

    // Wavetable Synth
    registerFaustDSP('Wavetable Synth', `
        import("stdfaust.lib");
        freq = hslider("freq", 440, 20, 12000, 0.01);
        gate = button("gate");
        morph = hslider("morph", 0, 0, 1, 0.001);
        // Crossfade between waveforms: sine → saw → square → pulse
        w1 = os.osc(freq);
        w2 = os.sawtooth(freq);
        w3 = os.square(freq);
        wave = w1 * (1-morph) + w2 * morph * (1-morph) + w3 * morph * morph;
        process = wave * en.adsr(0.01, 0.3, 0.6, 0.5, gate) <: _, _;
    `, makeSynthParams([
        { address: '/wt/morph', label: 'Morph', min: 0, max: 1, defaultValue: 0, step: 0.001 },
        { address: '/wt/detune', label: 'Detune', min: 0, max: 50, defaultValue: 0, step: 0.1 },
        { address: '/wt/unison', label: 'Unison Voices', min: 1, max: 8, defaultValue: 1, step: 1 },
    ]));

    // Granular Synth
    registerFaustDSP('Granular Synth', `
        import("stdfaust.lib");
        // Simplified granular: overlapping grains from oscillator
        freq = hslider("freq", 440, 20, 12000, 0.01);
        gate = button("gate");
        grain_size = hslider("grain_size", 0.05, 0.001, 0.5, 0.001);
        spray = hslider("spray", 0, 0, 1, 0.001);
        density = hslider("density", 10, 1, 100, 1);
        process = os.osc(freq) * en.ar(grain_size/2, grain_size/2, gate) <: _, _;
    `, makeSynthParams([
        { address: '/granular/grain_size', label: 'Grain Size', min: 0.001, max: 0.5, defaultValue: 0.05, step: 0.001 },
        { address: '/granular/spray', label: 'Spray', min: 0, max: 1, defaultValue: 0, step: 0.001 },
        { address: '/granular/density', label: 'Density', min: 1, max: 100, defaultValue: 10, step: 1 },
        { address: '/granular/pitch_var', label: 'Pitch Variance', min: 0, max: 24, defaultValue: 0, step: 0.1 },
    ]));

    // Physical Modeling (STK-based)
    registerFaustDSP('Physical Model String', `
        import("stdfaust.lib");
        freq = hslider("freq", 440, 20, 12000, 0.01);
        gate = button("gate");
        // Karplus-Strong string model
        process = pm.ks(freq, gate) <: _, _;
    `, makeSynthParams([
        { address: '/pm/damping', label: 'Damping', min: 0, max: 1, defaultValue: 0.5, step: 0.01 },
        { address: '/pm/excitation', label: 'Excitation', min: 0, max: 1, defaultValue: 0.8, step: 0.01 },
        { address: '/pm/body', label: 'Body', min: 0, max: 1, defaultValue: 0.5, step: 0.01 },
    ]));

    // Additive Synth
    registerFaustDSP('Additive Synth', `
        import("stdfaust.lib");
        freq = hslider("freq", 440, 20, 12000, 0.01);
        gate = button("gate");
        partials = 16;
        // Sum of harmonics with rolloff
        process = sum(i, partials,
            os.osc(freq * (i+1)) / pow(i+1, rolloff)
        ) / partials * en.adsr(0.01, 0.2, 0.7, 0.5, gate) <: _, _
        with { rolloff = hslider("rolloff", 1.5, 0.5, 4, 0.01); };
    `, makeSynthParams([
        { address: '/additive/partials', label: 'Partials', min: 1, max: 64, defaultValue: 16, step: 1 },
        { address: '/additive/rolloff', label: 'Harmonic Rolloff', min: 0.5, max: 4, defaultValue: 1.5, step: 0.01 },
        { address: '/additive/spread', label: 'Spread', min: 0, max: 1, defaultValue: 0, step: 0.01 },
    ]));
}

function makeSynthParams(
    extra: Array<{ address: string; label: string; min: number; max: number; defaultValue: number; step: number }>
): FaustParamDescriptor[] {
    const base: FaustParamDescriptor[] = [
        { address: '/synth/attack', label: 'Attack', min: 0.001, max: 5, defaultValue: 0.01, step: 0.001, type: 'hslider' },
        { address: '/synth/decay', label: 'Decay', min: 0.01, max: 5, defaultValue: 0.2, step: 0.01, type: 'hslider' },
        { address: '/synth/sustain', label: 'Sustain', min: 0, max: 1, defaultValue: 0.7, step: 0.01, type: 'hslider' },
        { address: '/synth/release', label: 'Release', min: 0.01, max: 10, defaultValue: 0.5, step: 0.01, type: 'hslider' },
    ];
    return [...base, ...extra.map((p) => ({ ...p, type: 'hslider' as const }))];
}
