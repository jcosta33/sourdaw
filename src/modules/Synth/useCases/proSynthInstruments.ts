/**
 * Pro Synth Instruments (Faust-based).
 * DSP definitions for professional synthesizer instruments.
 *
 * NOTE: FM Synth and Rhodes are registered in faustEngine.ts — do NOT re-register here.
 */

import { registerFaustDSP, type FaustParamDescriptor } from '#/modules/Plugin/useCases';

/**
 * Register all pro synth instruments.
 */
export function registerProSynthInstruments(): void {
    // Morphing Synth — morph crossfade across 4 waveforms with ADSR
    registerFaustDSP(
        'Morphing Synth',
        `
        import("stdfaust.lib");
        freq = hslider("freq", 440, 20, 12000, 0.01);
        gain = hslider("gain", 0.5, 0, 1, 0.01);
        gate = button("gate");
        morph = hslider("morph", 0, 0, 1, 0.001) : si.smoo;
        atk = hslider("attack", 0.01, 0.001, 5, 0.001);
        dec = hslider("decay", 0.3, 0.01, 5, 0.01);
        sus = hslider("sustain", 0.6, 0, 1, 0.01);
        rel = hslider("release", 0.5, 0.01, 10, 0.01);
        // 4 waveforms: sine → triangle → saw → square
        w1 = os.osc(freq);
        w2 = os.triangle(freq);
        w3 = os.sawtooth(freq);
        w4 = os.square(freq);
        // Segment crossfade: morph 0..0.33 = w1↔w2, 0.33..0.66 = w2↔w3, 0.66..1 = w3↔w4
        seg = morph * 3;
        s1 = min(1, max(0, 1 - seg));
        s2 = min(1, max(0, min(seg, 2 - seg)));
        s3 = min(1, max(0, min(seg - 1, 3 - seg)));
        s4 = min(1, max(0, seg - 2));
        wave = w1 * s1 + w2 * s2 + w3 * s3 + w4 * s4;
        env = en.adsr(atk, dec, sus, rel, gate);
        process = wave * env * gain <: _, _;
    `,
        [
            {
                address: '/wt/morph',
                label: 'Morph',
                min: 0,
                max: 1,
                defaultValue: 0,
                step: 0.001,
                type: 'hslider' as const,
            },
            {
                address: '/wt/attack',
                label: 'Attack',
                min: 0.001,
                max: 5,
                defaultValue: 0.01,
                step: 0.001,
                type: 'hslider',
                scaling: 'log' as const,
            },
            {
                address: '/wt/decay',
                label: 'Decay',
                min: 0.01,
                max: 5,
                defaultValue: 0.3,
                step: 0.01,
                type: 'hslider',
                scaling: 'log' as const,
            },
            {
                address: '/wt/sustain',
                label: 'Sustain',
                min: 0,
                max: 1,
                defaultValue: 0.6,
                step: 0.01,
                type: 'hslider' as const,
            },
            {
                address: '/wt/release',
                label: 'Release',
                min: 0.01,
                max: 10,
                defaultValue: 0.5,
                step: 0.01,
                type: 'hslider',
                scaling: 'log' as const,
            },
            {
                address: '/wt/gain',
                label: 'Gain',
                min: 0,
                max: 1,
                defaultValue: 0.5,
                step: 0.01,
                type: 'hslider' as const,
            },
        ],
        true
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
        
        lfo_rate = hslider("lfo_rate", 5, 0.1, 20, 0.1);
        lfo_depth = hslider("lfo_depth", 0, 0, 1, 0.01);
        lfo = os.osc(lfo_rate) * lfo_depth;

        cutoff = hslider("cutoff", 6000, 100, 20000, 1);
        mod_cutoff = cutoff * (1 + lfo * 0.5) : max(100) : min(20000) : si.smoo;
        
        resonance = hslider("resonance", 0.3, 0, 0.99, 0.01);
        filtered = fi.resonlp(mod_cutoff, 1 + resonance * 8, raw);
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
                address: '/supersaw/lfo_rate',
                label: 'LFO Rate',
                min: 0.1,
                max: 20,
                defaultValue: 5,
                step: 0.1,
                type: 'hslider',
            },
            {
                address: '/supersaw/lfo_depth',
                label: 'LFO Depth',
                min: 0,
                max: 1,
                defaultValue: 0,
                step: 0.01,
                type: 'hslider',
            },
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
                scaling: 'log',
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
                scaling: 'log',
            },
            {
                address: '/synth/decay',
                label: 'Decay',
                min: 0.01,
                max: 5,
                defaultValue: 0.3,
                step: 0.01,
                type: 'hslider',
                scaling: 'log',
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
                scaling: 'log',
            },
        ],
        true
    );

    // Physical Modeling — Karplus-Strong string with excitation, damping, body controls
    registerFaustDSP(
        'Physical Model String',
        `
        import("stdfaust.lib");
        freq = hslider("freq", 440, 20, 12000, 0.01);
        gain = hslider("gain", 0.5, 0, 1, 0.01);
        gate = button("gate");
        damping = hslider("damping", 0.5, 0, 1, 0.01);
        excitation = hslider("excitation", 0.8, 0, 1, 0.01);
        body = hslider("body", 0.5, 0, 1, 0.01);
        // Excitation burst: filtered noise
        burst_len = 0.003;
        burst = no.noise * excitation * en.ar(0.0001, burst_len, gate);
        // Karplus-Strong: delay line with damped feedback
        delay_samples = ma.SR / freq;
        damp_coeff = 0.99 - damping * 0.15;
        ks_loop = + ~ (de.fdelay(4096, delay_samples - 1) : fi.lowpass(1, freq * (2 + body * 8)) : *(damp_coeff));
        process = burst : ks_loop * gain <: _, _;
    `,
        [
            {
                address: '/pm/damping',
                label: 'Damping',
                min: 0,
                max: 1,
                defaultValue: 0.5,
                step: 0.01,
                type: 'hslider' as const,
            },
            {
                address: '/pm/excitation',
                label: 'Excitation',
                min: 0,
                max: 1,
                defaultValue: 0.8,
                step: 0.01,
                type: 'hslider' as const,
            },
            {
                address: '/pm/body',
                label: 'Body',
                min: 0,
                max: 1,
                defaultValue: 0.5,
                step: 0.01,
                type: 'hslider' as const,
            },
            {
                address: '/pm/gain',
                label: 'Gain',
                min: 0,
                max: 1,
                defaultValue: 0.5,
                step: 0.01,
                type: 'hslider' as const,
            },
        ],
        true
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
        ]),
        true
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
            scaling: 'log',
        },
        {
            address: '/synth/decay',
            label: 'Decay',
            min: 0.01,
            max: 5,
            defaultValue: 0.2,
            step: 0.01,
            type: 'hslider',
            scaling: 'log',
        },
        { address: '/synth/sustain', label: 'Sustain', min: 0, max: 1, defaultValue: 0.7, step: 0.01, type: 'hslider' },
        {
            address: '/synth/release',
            label: 'Release',
            min: 0.01,
            max: 10,
            defaultValue: 0.5,
            step: 0.01,
            type: 'hslider',
            scaling: 'log',
        },
    ];
    return [...base, ...extra.map((p) => ({ ...p, type: 'hslider' as const }))];
}
