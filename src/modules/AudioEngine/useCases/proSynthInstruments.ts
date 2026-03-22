/**
 * Pro Synth Instruments (Faust-based).
 * DSP definitions for professional synthesizer instruments.
 *
 * NOTE: FM Synth and Rhodes are registered in faustEngine.ts — do NOT re-register here.
 */

import { registerFaustDSP, type FaustParamDescriptor } from './faustEngine';

/**
 * Register all pro synth instruments.
 */
export function registerProSynthInstruments(): void {
    // Wavetable Synth
    registerFaustDSP(
        'Wavetable Synth',
        `
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
    `,
        makeSynthParams([
            { address: '/wt/morph', label: 'Morph', min: 0, max: 1, defaultValue: 0, step: 0.001 },
            { address: '/wt/detune', label: 'Detune', min: 0, max: 50, defaultValue: 0, step: 0.1 },
            { address: '/wt/unison', label: 'Unison Voices', min: 1, max: 8, defaultValue: 1, step: 1 },
        ])
    );

    // Supersaw Unison Synth — 7 detuned sawtooth oscillators summed and normalised.
    // Classic trance/EDM supersaw texture. detune controls spread (cents between voices).
    registerFaustDSP(
        'Supersaw Unison',
        `
        import("stdfaust.lib");
        freq  = hslider("freq", 440, 20, 12000, 0.01);
        gate  = button("gate");
        det   = hslider("detune", 15, 0, 100, 0.1);
        mix   = hslider("center_mix", 0.7, 0, 1, 0.01);
        // 7 voices: center + 3 pairs spread above/below in cents
        spread(n) = pow(2, n * det / 1200);
        v0 =  os.sawtooth(freq)             * mix;
        v1 =  os.sawtooth(freq * spread(1)) * (1-mix) * 0.5;
        v2 =  os.sawtooth(freq / spread(1)) * (1-mix) * 0.5;
        v3 =  os.sawtooth(freq * spread(2)) * (1-mix) * 0.4;
        v4 =  os.sawtooth(freq / spread(2)) * (1-mix) * 0.4;
        v5 =  os.sawtooth(freq * spread(3)) * (1-mix) * 0.3;
        v6 =  os.sawtooth(freq / spread(3)) * (1-mix) * 0.3;
        raw = (v0 + v1 + v2 + v3 + v4 + v5 + v6) / 3.4;
        cutoff = hslider("cutoff", 6000, 100, 20000, 1);
        resonance = hslider("resonance", 0.3, 0, 0.99, 0.01);
        filtered = fi.resonlp(cutoff, 1 + resonance * 8, raw);
        process = filtered * en.adsr(
            hslider("attack",  0.01,  0.001, 5, 0.001),
            hslider("decay",   0.3,   0.01,  5, 0.01),
            hslider("sustain", 0.8,   0,     1, 0.01),
            hslider("release", 0.5,   0.01, 10, 0.01),
            gate
        ) <: _, _;
    `,
        [
            {
                address: '/supersaw/detune',
                label: 'Detune (cents)',
                min: 0,
                max: 100,
                defaultValue: 15,
                step: 0.1,
                type: 'hslider',
            },
            {
                address: '/supersaw/center_mix',
                label: 'Center Mix',
                min: 0,
                max: 1,
                defaultValue: 0.7,
                step: 0.01,
                type: 'hslider',
            },
            {
                address: '/supersaw/cutoff',
                label: 'Cutoff',
                min: 100,
                max: 20000,
                defaultValue: 6000,
                step: 1,
                type: 'hslider',
            },
            {
                address: '/supersaw/resonance',
                label: 'Resonance',
                min: 0,
                max: 0.99,
                defaultValue: 0.3,
                step: 0.01,
                type: 'hslider',
            },
            {
                address: '/synth/attack',
                label: 'Attack',
                min: 0.001,
                max: 5,
                defaultValue: 0.01,
                step: 0.001,
                type: 'hslider',
            },
            {
                address: '/synth/decay',
                label: 'Decay',
                min: 0.01,
                max: 5,
                defaultValue: 0.3,
                step: 0.01,
                type: 'hslider',
            },
            {
                address: '/synth/sustain',
                label: 'Sustain',
                min: 0,
                max: 1,
                defaultValue: 0.8,
                step: 0.01,
                type: 'hslider',
            },
            {
                address: '/synth/release',
                label: 'Release',
                min: 0.01,
                max: 10,
                defaultValue: 0.5,
                step: 0.01,
                type: 'hslider',
            },
        ]
    );

    // Physical Modeling (Karplus-Strong string)
    registerFaustDSP(
        'Physical Model String',
        `
        import("stdfaust.lib");
        freq = hslider("freq", 440, 20, 12000, 0.01);
        gate = button("gate");
        // Karplus-Strong string model
        process = pm.ks(freq, gate) <: _, _;
    `,
        makeSynthParams([
            { address: '/pm/damping', label: 'Damping', min: 0, max: 1, defaultValue: 0.5, step: 0.01 },
            { address: '/pm/excitation', label: 'Excitation', min: 0, max: 1, defaultValue: 0.8, step: 0.01 },
            { address: '/pm/body', label: 'Body', min: 0, max: 1, defaultValue: 0.5, step: 0.01 },
        ])
    );

    // Additive Synth
    registerFaustDSP(
        'Additive Synth',
        `
        import("stdfaust.lib");
        freq = hslider("freq", 440, 20, 12000, 0.01);
        gate = button("gate");
        partials = 16;
        // Sum of harmonics with rolloff
        process = sum(i, partials,
            os.osc(freq * (i+1)) / pow(i+1, rolloff)
        ) / partials * en.adsr(0.01, 0.2, 0.7, 0.5, gate) <: _, _
        with { rolloff = hslider("rolloff", 1.5, 0.5, 4, 0.01); };
    `,
        makeSynthParams([
            { address: '/additive/partials', label: 'Partials', min: 1, max: 64, defaultValue: 16, step: 1 },
            {
                address: '/additive/rolloff',
                label: 'Harmonic Rolloff',
                min: 0.5,
                max: 4,
                defaultValue: 1.5,
                step: 0.01,
            },
            { address: '/additive/spread', label: 'Spread', min: 0, max: 1, defaultValue: 0, step: 0.01 },
        ])
    );
}

function makeSynthParams(
    extra: Array<{ address: string; label: string; min: number; max: number; defaultValue: number; step: number }>
): FaustParamDescriptor[] {
    const base: FaustParamDescriptor[] = [
        {
            address: '/synth/attack',
            label: 'Attack',
            min: 0.001,
            max: 5,
            defaultValue: 0.01,
            step: 0.001,
            type: 'hslider',
        },
        { address: '/synth/decay', label: 'Decay', min: 0.01, max: 5, defaultValue: 0.2, step: 0.01, type: 'hslider' },
        { address: '/synth/sustain', label: 'Sustain', min: 0, max: 1, defaultValue: 0.7, step: 0.01, type: 'hslider' },
        {
            address: '/synth/release',
            label: 'Release',
            min: 0.01,
            max: 10,
            defaultValue: 0.5,
            step: 0.01,
            type: 'hslider',
        },
    ];
    return [...base, ...extra.map((p) => ({ ...p, type: 'hslider' as const }))];
}
