/**
 * Built-in Faust DSP definitions.
 *
 * Each call to registerFaustDSP registers a Faust source + parameter descriptors
 * that can be compiled to WASM AudioWorkletNodes on demand.
 *
 * This file is ~900 lines of DSP source code and param descriptors.
 * Extracted from faustEngine.ts for maintainability.
 */

import { registerFaustDSP } from './compilerEngine';

export function registerBuiltinFaustDSP(): void {
    // ── Zita-Rev1 algorithmic reverb ──────────────────────────
    registerFaustDSP(
        'Zita-Rev1 Reverb',
        `
        import("stdfaust.lib");
        process = re.zita_rev1_stereo(rdel, f1, f2, t60dc, t60m, fsmax)
        with { rdel = 60; f1 = 200; f2 = 6000; t60dc = 3; t60m = 2; fsmax = 48000; };
    `,
        [
            {
                address: '/zita/decay_time',
                label: 'Decay Time',
                min: 0.1,
                max: 15,
                defaultValue: 3,
                step: 0.1,
                type: 'hslider',
            },
            {
                address: '/zita/damping',
                label: 'Damping',
                min: 200,
                max: 12000,
                defaultValue: 6000,
                step: 100,
                type: 'hslider',
            },
            {
                address: '/zita/dry_wet',
                label: 'Dry/Wet',
                min: 0,
                max: 1,
                defaultValue: 0.3,
                step: 0.01,
                type: 'hslider',
            },
        ]
    );

    // ── 1176 compressor model ─────────────────────────────────
    registerFaustDSP(
        '1176 Compressor',
        `
        import("stdfaust.lib");
        process = co.compressor_stereo(ratio, thresh, attack, release)
        with {
            ratio = hslider("ratio", 4, 1, 20, 0.1);
            thresh = hslider("threshold", -20, -60, 0, 0.1);
            attack = hslider("attack", 0.001, 0.0001, 0.1, 0.0001);
            release = hslider("release", 0.1, 0.01, 1, 0.001);
        };
    `,
        [
            { address: '/1176/ratio', label: 'Ratio', min: 1, max: 20, defaultValue: 4, step: 0.1, type: 'hslider' },
            {
                address: '/1176/threshold',
                label: 'Threshold',
                min: -60,
                max: 0,
                defaultValue: -20,
                step: 0.1,
                type: 'hslider',
            },
            {
                address: '/1176/attack',
                label: 'Attack',
                min: 0.0001,
                max: 0.1,
                defaultValue: 0.001,
                step: 0.0001,
                type: 'hslider',
                scaling: 'log',
            },
            {
                address: '/1176/release',
                label: 'Release',
                min: 0.01,
                max: 1,
                defaultValue: 0.1,
                step: 0.001,
                type: 'hslider',
                scaling: 'log',
            },
        ]
    );

    // ── Multiband compressor ──────────────────────────────────
    registerFaustDSP(
        'Multiband Compressor',
        `
        import("stdfaust.lib");
        process = dm.compressor_demo;
    `,
        [
            {
                address: '/multiband/low_threshold',
                label: 'Low Threshold',
                min: -60,
                max: 0,
                defaultValue: -20,
                step: 0.5,
                type: 'hslider',
            },
            {
                address: '/multiband/mid_threshold',
                label: 'Mid Threshold',
                min: -60,
                max: 0,
                defaultValue: -15,
                step: 0.5,
                type: 'hslider',
            },
            {
                address: '/multiband/high_threshold',
                label: 'High Threshold',
                min: -60,
                max: 0,
                defaultValue: -10,
                step: 0.5,
                type: 'hslider',
            },
            {
                address: '/multiband/crossover_low',
                label: 'Low Crossover',
                min: 50,
                max: 500,
                defaultValue: 200,
                step: 10,
                type: 'hslider',
            },
            {
                address: '/multiband/crossover_high',
                label: 'High Crossover',
                min: 1000,
                max: 10000,
                defaultValue: 3000,
                step: 100,
                type: 'hslider',
            },
        ]
    );

    // ── Pro Parametric EQ ─────────────────────────────────────
    registerFaustDSP(
        'Pro Parametric EQ',
        `
        import("stdfaust.lib");
        process = vgroup("eq", 
            fi.low_shelf(lf_gain, lf_freq) :
            fi.peak_eq(mf_gain, mf_freq, mf_q) :
            fi.high_shelf(hf_gain, hf_freq)
        ) with {
            lf_gain = hslider("lf_gain", 0, -18, 18, 0.1);
            lf_freq = hslider("lf_freq", 100, 20, 500, 1);
            mf_gain = hslider("mf_gain", 0, -18, 18, 0.1);
            mf_freq = hslider("mf_freq", 1000, 200, 8000, 1);
            mf_q = hslider("mf_q", 1, 0.1, 10, 0.1);
            hf_gain = hslider("hf_gain", 0, -18, 18, 0.1);
            hf_freq = hslider("hf_freq", 8000, 1000, 20000, 100);
        };
    `,
        [
            {
                address: '/eq/lf_gain',
                label: 'Low Gain',
                min: -18,
                max: 18,
                defaultValue: 0,
                step: 0.1,
                type: 'hslider',
            },
            {
                address: '/eq/lf_freq',
                label: 'Low Freq',
                min: 20,
                max: 500,
                defaultValue: 100,
                step: 1,
                type: 'hslider',
            },
            {
                address: '/eq/mf_gain',
                label: 'Mid Gain',
                min: -18,
                max: 18,
                defaultValue: 0,
                step: 0.1,
                type: 'hslider',
            },
            {
                address: '/eq/mf_freq',
                label: 'Mid Freq',
                min: 200,
                max: 8000,
                defaultValue: 1000,
                step: 1,
                type: 'hslider',
            },
            { address: '/eq/mf_q', label: 'Mid Q', min: 0.1, max: 10, defaultValue: 1, step: 0.1, type: 'hslider' },
            {
                address: '/eq/hf_gain',
                label: 'High Gain',
                min: -18,
                max: 18,
                defaultValue: 0,
                step: 0.1,
                type: 'hslider',
            },
            {
                address: '/eq/hf_freq',
                label: 'High Freq',
                min: 1000,
                max: 20000,
                defaultValue: 8000,
                step: 100,
                type: 'hslider',
            },
        ]
    );

    // ── Tape Delay ────────────────────────────────────────────
    registerFaustDSP(
        'Tape Delay',
        `
        import("stdfaust.lib");
        process = ef.echo(maxdel, delay, feedback)
        with {
            maxdel = 2.0;
            delay = hslider("delay", 0.3, 0.01, 2, 0.01);
            feedback = hslider("feedback", 0.5, 0, 0.95, 0.01);
        };
    `,
        [
            {
                address: '/tape_delay/delay',
                label: 'Delay Time',
                min: 0.01,
                max: 2,
                defaultValue: 0.3,
                step: 0.01,
                type: 'hslider',
            },
            {
                address: '/tape_delay/feedback',
                label: 'Feedback',
                min: 0,
                max: 0.95,
                defaultValue: 0.5,
                step: 0.01,
                type: 'hslider',
            },
            {
                address: '/tape_delay/wow_flutter',
                label: 'Wow & Flutter',
                min: 0,
                max: 1,
                defaultValue: 0.3,
                step: 0.01,
                type: 'hslider',
            },
            {
                address: '/tape_delay/tone',
                label: 'Tone',
                min: 500,
                max: 12000,
                defaultValue: 4000,
                step: 100,
                type: 'hslider',
            },
        ]
    );

    // ── Brick-Wall Limiter ────────────────────────────────────
    registerFaustDSP(
        'Brick-Wall Limiter',
        `
        import("stdfaust.lib");
        process = co.limiter_1176_R4_stereo;
    `,
        [
            {
                address: '/limiter/ceiling',
                label: 'Ceiling',
                min: -6,
                max: 0,
                defaultValue: -0.3,
                step: 0.1,
                type: 'hslider',
            },
            {
                address: '/limiter/release',
                label: 'Release',
                min: 10,
                max: 500,
                defaultValue: 100,
                step: 1,
                type: 'hslider',
                scaling: 'log',
            },
            {
                address: '/limiter/lookahead',
                label: 'Lookahead (ms)',
                min: 0,
                max: 10,
                defaultValue: 5,
                step: 0.5,
                type: 'hslider',
            },
        ]
    );

    // ── Spring Reverb ─────────────────────────────────────────
    registerFaustDSP(
        'Spring Reverb',
        `
        import("stdfaust.lib");
        process = re.mono_freeverb(fb1, fb2, damp, spread);
    `,
        [
            {
                address: '/spring/decay',
                label: 'Decay',
                min: 0.1,
                max: 8,
                defaultValue: 2,
                step: 0.1,
                type: 'hslider',
                scaling: 'log',
            },
            {
                address: '/spring/brightness',
                label: 'Brightness',
                min: 0,
                max: 1,
                defaultValue: 0.5,
                step: 0.01,
                type: 'hslider',
            },
            { address: '/spring/mix', label: 'Mix', min: 0, max: 1, defaultValue: 0.25, step: 0.01, type: 'hslider' },
        ]
    );

    // ══════════════════════════════════════════════════════════
    // ██  INSTRUMENTS  ████████████████████████████████████████
    // ══════════════════════════════════════════════════════════

    // ── FM Synth ──────────────────────────────────────────────
    registerFaustDSP(
        'FM Synth',
        `
        import("stdfaust.lib");
        freq = hslider("freq", 440, 20, 10000, 0.1);
        gain = hslider("gain", 0.5, 0, 1, 0.01);
        gate = button("gate");
        algo = hslider("algorithm", 0, 0, 3, 1);
        
        // OP1 (Carrier)
        r1 = hslider("op1_ratio", 1, 0.5, 16, 0.01);
        l1 = hslider("op1_level", 1, 0, 1, 0.01);
        a1 = hslider("op1_attack", 0.01, 0.001, 5, 0.001);
        d1 = hslider("op1_decay", 0.1, 0.01, 5, 0.01);
        s1 = hslider("op1_sustain", 0.8, 0, 1, 0.01);
        rel1 = hslider("op1_release", 0.5, 0.01, 10, 0.01);
        env1 = en.adsr(a1, d1, s1, rel1, gate);
        
        // OP2
        r2 = hslider("op2_ratio", 2, 0.5, 16, 0.01);
        l2 = hslider("op2_level", 0.5, 0, 1, 0.01);
        a2 = hslider("op2_attack", 0.01, 0.001, 5, 0.001);
        d2 = hslider("op2_decay", 0.1, 0.01, 5, 0.01);
        s2 = hslider("op2_sustain", 0.8, 0, 1, 0.01);
        rel2 = hslider("op2_release", 0.5, 0.01, 10, 0.01);
        env2 = en.adsr(a2, d2, s2, rel2, gate);
        
        // OP3
        r3 = hslider("op3_ratio", 3, 0.5, 16, 0.01);
        l3 = hslider("op3_level", 0.5, 0, 1, 0.01);
        a3 = hslider("op3_attack", 0.01, 0.001, 5, 0.001);
        d3 = hslider("op3_decay", 0.1, 0.01, 5, 0.01);
        s3 = hslider("op3_sustain", 0.8, 0, 1, 0.01);
        rel3 = hslider("op3_release", 0.5, 0.01, 10, 0.01);
        env3 = en.adsr(a3, d3, s3, rel3, gate);

        // OP4
        r4 = hslider("op4_ratio", 4, 0.5, 16, 0.01);
        l4 = hslider("op4_level", 0.5, 0, 1, 0.01);
        a4 = hslider("op4_attack", 0.01, 0.001, 5, 0.001);
        d4 = hslider("op4_decay", 0.1, 0.01, 5, 0.01);
        s4 = hslider("op4_sustain", 0.8, 0, 1, 0.01);
        rel4 = hslider("op4_release", 0.5, 0.01, 10, 0.01);
        env4 = en.adsr(a4, d4, s4, rel4, gate);

        f1 = freq * r1;
        f2 = freq * r2;
        f3 = freq * r3;
        f4 = freq * r4;

        // Algorithms
        // 0: 4->3->2->1 (Cascade)
        op4_0 = os.osc(f4) * f4 * l4 * env4;
        op3_0 = os.osc(f3 + op4_0) * f3 * l3 * env3;
        op2_0 = os.osc(f2 + op3_0) * f2 * l2 * env2;
        op1_0 = os.osc(f1 + op2_0) * l1 * env1;

        // 1: (4+3)->2->1
        op4_1 = os.osc(f4) * f4 * l4 * env4;
        op3_1 = os.osc(f3) * f3 * l3 * env3;
        op2_1 = os.osc(f2 + op4_1 + op3_1) * f2 * l2 * env2;
        op1_1 = os.osc(f1 + op2_1) * l1 * env1;

        // 2: (4->3) + 2 -> 1
        op4_2 = os.osc(f4) * f4 * l4 * env4;
        op3_2 = os.osc(f3 + op4_2) * f3 * l3 * env3;
        op2_2 = os.osc(f2) * f2 * l2 * env2;
        op1_2 = os.osc(f1 + op3_2 + op2_2) * l1 * env1;

        // 3: 4->3, 2->1 (Parallel carriers)
        op4_3 = os.osc(f4) * f4 * l4 * env4;
        op3_3 = os.osc(f3 + op4_3) * l3 * env3;
        op2_3 = os.osc(f2) * f2 * l2 * env2;
        op1_3 = os.osc(f1 + op2_3) * l1 * env1;
        
        out = ba.selectn(4, algo, op1_0, op1_1, op1_2, (op1_3 + op3_3) * 0.5);
        process = out * gain <: _, _;
    `,
        [
            {
                address: '/fm_synth/algorithm',
                label: 'Algorithm',
                min: 0,
                max: 3,
                defaultValue: 0,
                step: 1,
                type: 'hslider',
            },

            {
                address: '/fm_synth/op1_ratio',
                label: 'OP1 Ratio',
                min: 0.5,
                max: 16,
                defaultValue: 1,
                step: 0.01,
                type: 'hslider',
            },
            {
                address: '/fm_synth/op1_level',
                label: 'OP1 Level',
                min: 0,
                max: 1,
                defaultValue: 1,
                step: 0.01,
                type: 'hslider',
            },
            {
                address: '/fm_synth/op1_attack',
                label: 'OP1 Attack',
                min: 0.001,
                max: 5,
                defaultValue: 0.01,
                step: 0.001,
                type: 'hslider',
            },
            {
                address: '/fm_synth/op1_decay',
                label: 'OP1 Decay',
                min: 0.01,
                max: 5,
                defaultValue: 0.1,
                step: 0.01,
                type: 'hslider',
            },
            {
                address: '/fm_synth/op1_sustain',
                label: 'OP1 Sustain',
                min: 0,
                max: 1,
                defaultValue: 0.8,
                step: 0.01,
                type: 'hslider',
            },
            {
                address: '/fm_synth/op1_release',
                label: 'OP1 Release',
                min: 0.01,
                max: 10,
                defaultValue: 0.5,
                step: 0.01,
                type: 'hslider',
            },

            {
                address: '/fm_synth/op2_ratio',
                label: 'OP2 Ratio',
                min: 0.5,
                max: 16,
                defaultValue: 2,
                step: 0.01,
                type: 'hslider',
            },
            {
                address: '/fm_synth/op2_level',
                label: 'OP2 Level',
                min: 0,
                max: 1,
                defaultValue: 0.5,
                step: 0.01,
                type: 'hslider',
            },
            {
                address: '/fm_synth/op2_attack',
                label: 'OP2 Attack',
                min: 0.001,
                max: 5,
                defaultValue: 0.01,
                step: 0.001,
                type: 'hslider',
            },
            {
                address: '/fm_synth/op2_decay',
                label: 'OP2 Decay',
                min: 0.01,
                max: 5,
                defaultValue: 0.1,
                step: 0.01,
                type: 'hslider',
            },
            {
                address: '/fm_synth/op2_sustain',
                label: 'OP2 Sustain',
                min: 0,
                max: 1,
                defaultValue: 0.8,
                step: 0.01,
                type: 'hslider',
            },
            {
                address: '/fm_synth/op2_release',
                label: 'OP2 Release',
                min: 0.01,
                max: 10,
                defaultValue: 0.5,
                step: 0.01,
                type: 'hslider',
            },

            {
                address: '/fm_synth/op3_ratio',
                label: 'OP3 Ratio',
                min: 0.5,
                max: 16,
                defaultValue: 3,
                step: 0.01,
                type: 'hslider',
            },
            {
                address: '/fm_synth/op3_level',
                label: 'OP3 Level',
                min: 0,
                max: 1,
                defaultValue: 0.5,
                step: 0.01,
                type: 'hslider',
            },
            {
                address: '/fm_synth/op3_attack',
                label: 'OP3 Attack',
                min: 0.001,
                max: 5,
                defaultValue: 0.01,
                step: 0.001,
                type: 'hslider',
            },
            {
                address: '/fm_synth/op3_decay',
                label: 'OP3 Decay',
                min: 0.01,
                max: 5,
                defaultValue: 0.1,
                step: 0.01,
                type: 'hslider',
            },
            {
                address: '/fm_synth/op3_sustain',
                label: 'OP3 Sustain',
                min: 0,
                max: 1,
                defaultValue: 0.8,
                step: 0.01,
                type: 'hslider',
            },
            {
                address: '/fm_synth/op3_release',
                label: 'OP3 Release',
                min: 0.01,
                max: 10,
                defaultValue: 0.5,
                step: 0.01,
                type: 'hslider',
            },

            {
                address: '/fm_synth/op4_ratio',
                label: 'OP4 Ratio',
                min: 0.5,
                max: 16,
                defaultValue: 4,
                step: 0.01,
                type: 'hslider',
            },
            {
                address: '/fm_synth/op4_level',
                label: 'OP4 Level',
                min: 0,
                max: 1,
                defaultValue: 0.5,
                step: 0.01,
                type: 'hslider',
            },
            {
                address: '/fm_synth/op4_attack',
                label: 'OP4 Attack',
                min: 0.001,
                max: 5,
                defaultValue: 0.01,
                step: 0.001,
                type: 'hslider',
            },
            {
                address: '/fm_synth/op4_decay',
                label: 'OP4 Decay',
                min: 0.01,
                max: 5,
                defaultValue: 0.1,
                step: 0.01,
                type: 'hslider',
            },
            {
                address: '/fm_synth/op4_sustain',
                label: 'OP4 Sustain',
                min: 0,
                max: 1,
                defaultValue: 0.8,
                step: 0.01,
                type: 'hslider',
            },
            {
                address: '/fm_synth/op4_release',
                label: 'OP4 Release',
                min: 0.01,
                max: 10,
                defaultValue: 0.5,
                step: 0.01,
                type: 'hslider',
            },

            {
                address: '/fm_synth/gain',
                label: 'Gain',
                min: 0,
                max: 1,
                defaultValue: 0.5,
                step: 0.01,
                type: 'hslider',
            },
        ],
        true
    );

    // ── Rhodes Electric Piano ─────────────────────────────────
    // Body/bell dual-envelope FM architecture per instruments.md
    registerFaustDSP(
        'Rhodes',
        `
        import("stdfaust.lib");
        freq = hslider("freq", 440, 20, 10000, 0.1);
        gain = hslider("gain", 0.5, 0, 1, 0.01);
        gate = button("gate");
        brightness = hslider("brightness", 0.5, 0, 1, 0.01);
        body_decay = hslider("body_decay", 1.5, 0.1, 5, 0.01);
        bell_decay = hslider("bell_decay", 0.15, 0.01, 1, 0.01);
        modIdx = (0.5 + brightness * 3.0) * gain;
        bodyEnv = en.adsr(0.001, body_decay, 0.15, 0.3, gate);
        bellEnv = en.adsr(0.001, bell_decay, 0.0, 0.1, gate);
        bodyMod = os.osc(freq) * modIdx * freq;
        body = os.osc(freq + bodyMod) * bodyEnv * 0.7;
        bellMod = os.osc(freq * 14) * modIdx * 0.5 * freq;
        bell = os.osc(freq * 14 + bellMod) * bellEnv * 0.3;
        process = (body + bell) * gain <: _, _;
    `,
        [
            {
                address: '/Rhodes/brightness',
                label: 'Brightness',
                min: 0,
                max: 1,
                defaultValue: 0.5,
                step: 0.01,
                type: 'hslider',
            },
            {
                address: '/Rhodes/body_decay',
                label: 'Body Decay',
                min: 0.1,
                max: 5,
                defaultValue: 1.5,
                step: 0.01,
                type: 'hslider',
            },
            {
                address: '/Rhodes/bell_decay',
                label: 'Bell Decay',
                min: 0.01,
                max: 1,
                defaultValue: 0.15,
                step: 0.01,
                type: 'hslider',
            },
            { address: '/Rhodes/gain', label: 'Gain', min: 0, max: 1, defaultValue: 0.5, step: 0.01, type: 'hslider' },
        ],
        true
    );

    // ── Noise Gate ────────────────────────────────────────────
    registerFaustDSP(
        'Noise Gate',
        `
        import("stdfaust.lib");
        process = co.gate_stereo(thresh, attack, hold, release)
        with {
            thresh = hslider("threshold", -60, -90, 0, 0.1);
            attack = hslider("attack", 0.001, 0.0001, 0.1, 0.0001);
            hold = hslider("hold", 0.01, 0, 0.5, 0.001);
            release = hslider("release", 0.1, 0.01, 1, 0.001);
        };
    `,
        [
            {
                address: '/Noise_Gate/threshold',
                label: 'Threshold',
                min: -90,
                max: 0,
                defaultValue: -60,
                step: 0.1,
                type: 'hslider',
            },
            {
                address: '/Noise_Gate/attack',
                label: 'Attack',
                min: 0.0001,
                max: 0.1,
                defaultValue: 0.001,
                step: 0.0001,
                type: 'hslider',
                scaling: 'log',
            },
            {
                address: '/Noise_Gate/hold',
                label: 'Hold',
                min: 0,
                max: 0.5,
                defaultValue: 0.01,
                step: 0.001,
                type: 'hslider',
            },
            {
                address: '/Noise_Gate/release',
                label: 'Release',
                min: 0.01,
                max: 1,
                defaultValue: 0.1,
                step: 0.001,
                type: 'hslider',
                scaling: 'log',
            },
        ]
    );

    // ── Gain Utility ──────────────────────────────────────────
    registerFaustDSP(
        'Gain Utility',
        `
        import("stdfaust.lib");
        gain = hslider("gain", 0, -36, 36, 0.1) : ba.db2linear;
        invert = checkbox("invert_phase") : ba.if(-1, 1);
        width = hslider("width", 1, 0, 2, 0.01);
        width_ctrl(L,R) = mid + side*width, mid - side*width
        with { mid = (L+R)*0.5; side = (L-R)*0.5; };
        process = _,_ : *(gain) * invert, *(gain) * invert : width_ctrl;
    `,
        [
            {
                address: '/Gain_Utility/gain',
                label: 'Gain (dB)',
                min: -36,
                max: 36,
                defaultValue: 0,
                step: 0.1,
                type: 'hslider',
            },
            {
                address: '/Gain_Utility/invert_phase',
                label: 'Invert Phase',
                min: 0,
                max: 1,
                defaultValue: 0,
                step: 1,
                type: 'checkbox',
            },
            {
                address: '/Gain_Utility/width',
                label: 'Stereo Width',
                min: 0,
                max: 2,
                defaultValue: 1,
                step: 0.01,
                type: 'hslider',
            },
        ]
    );

    // ── Hammond B3 Organ ──────────────────────────────────────
    // 9 drawbar tonewheel synthesis + key click + percussion + Leslie
    registerFaustDSP(
        'Hammond B3',
        `
        import("stdfaust.lib");
        freq = hslider("freq", 440, 20, 6000, 0.01);
        gain = hslider("gain", 0.5, 0, 1, 0.01);
        gate = button("gate");
        d1 = hslider("drawbar_16", 8, 0, 8, 1);
        d2 = hslider("drawbar_8", 8, 0, 8, 1);
        d3 = hslider("drawbar_513", 0, 0, 8, 1);
        d4 = hslider("drawbar_4", 0, 0, 8, 1);
        d5 = hslider("drawbar_223", 0, 0, 8, 1);
        d6 = hslider("drawbar_2", 0, 0, 8, 1);
        d7 = hslider("drawbar_135", 0, 0, 8, 1);
        d8 = hslider("drawbar_113", 0, 0, 8, 1);
        d9 = hslider("drawbar_1", 0, 0, 8, 1);
        perc_level = hslider("percussion", 0.3, 0, 1, 0.01);
        perc_harm = hslider("perc_harmonic", 2, 2, 3, 1);
        leslie_speed = hslider("leslie_speed", 6.0, 0.1, 12.0, 0.1);
        leslie_depth = hslider("leslie_depth", 0.25, 0.0, 0.8, 0.01);
        click_level = hslider("click", 0.3, 0, 1, 0.01);
        // Tonewheels with leakage (~-40dB adjacent crosstalk)
        leak = 0.01;
        tw(f, d) = os.osc(f) * d + os.osc(f * 1.0007) * d * leak;
        organ = tw(freq*0.5, d1) + tw(freq, d2) + tw(freq*1.5, d3) +
                tw(freq*2, d4) + tw(freq*3, d5) + tw(freq*4, d6) +
                tw(freq*5, d7) + tw(freq*6, d8) + tw(freq*8, d9);
        tonewheel = organ / 72.0;
        // Key click: filtered noise burst
        click = no.noise : fi.resonbp(3000, 2, 1) * en.ar(0.001, 0.004, gate) * click_level;
        // Percussion: 2nd or 3rd harmonic fast decay, single-trigger
        perc = os.osc(freq * perc_harm) * en.ar(0.001, 0.15, gate) * perc_level;
        // Leslie: L/R phase offset for stereo rotation
        leslie_l = (tonewheel + click + perc) * (1.0 + leslie_depth * os.osc(leslie_speed));
        leslie_r = (tonewheel + click + perc) * (1.0 + leslie_depth * os.osc(leslie_speed + 1.5708));
        env = en.adsr(0.005, 0.0, 1.0, 0.03, gate);
        process = leslie_l * env * gain, leslie_r * env * gain;
    `,
        [
            {
                address: '/Hammond_B3/drawbar_16',
                label: "16'",
                min: 0,
                max: 8,
                defaultValue: 8,
                step: 1,
                type: 'hslider',
            },
            {
                address: '/Hammond_B3/drawbar_8',
                label: "8'",
                min: 0,
                max: 8,
                defaultValue: 8,
                step: 1,
                type: 'hslider',
            },
            {
                address: '/Hammond_B3/drawbar_513',
                label: "5⅓'",
                min: 0,
                max: 8,
                defaultValue: 0,
                step: 1,
                type: 'hslider',
            },
            {
                address: '/Hammond_B3/drawbar_4',
                label: "4'",
                min: 0,
                max: 8,
                defaultValue: 0,
                step: 1,
                type: 'hslider',
            },
            {
                address: '/Hammond_B3/drawbar_223',
                label: "2⅔'",
                min: 0,
                max: 8,
                defaultValue: 0,
                step: 1,
                type: 'hslider',
            },
            {
                address: '/Hammond_B3/drawbar_2',
                label: "2'",
                min: 0,
                max: 8,
                defaultValue: 0,
                step: 1,
                type: 'hslider',
            },
            {
                address: '/Hammond_B3/drawbar_135',
                label: "1⅗'",
                min: 0,
                max: 8,
                defaultValue: 0,
                step: 1,
                type: 'hslider',
            },
            {
                address: '/Hammond_B3/drawbar_113',
                label: "1⅓'",
                min: 0,
                max: 8,
                defaultValue: 0,
                step: 1,
                type: 'hslider',
            },
            {
                address: '/Hammond_B3/drawbar_1',
                label: "1'",
                min: 0,
                max: 8,
                defaultValue: 0,
                step: 1,
                type: 'hslider',
            },
            {
                address: '/Hammond_B3/percussion',
                label: 'Percussion',
                min: 0,
                max: 1,
                defaultValue: 0.3,
                step: 0.01,
                type: 'hslider',
            },
            {
                address: '/Hammond_B3/perc_harmonic',
                label: 'Perc Harmonic',
                min: 2,
                max: 3,
                defaultValue: 2,
                step: 1,
                type: 'hslider',
            },
            {
                address: '/Hammond_B3/click',
                label: 'Key Click',
                min: 0,
                max: 1,
                defaultValue: 0.3,
                step: 0.01,
                type: 'hslider',
            },
            {
                address: '/Hammond_B3/leslie_speed',
                label: 'Leslie Speed',
                min: 0.1,
                max: 12,
                defaultValue: 6,
                step: 0.1,
                type: 'hslider',
            },
            {
                address: '/Hammond_B3/leslie_depth',
                label: 'Leslie Depth',
                min: 0,
                max: 0.8,
                defaultValue: 0.25,
                step: 0.01,
                type: 'hslider',
            },
            {
                address: '/Hammond_B3/gain',
                label: 'Gain',
                min: 0,
                max: 1,
                defaultValue: 0.5,
                step: 0.01,
                type: 'hslider',
            },
        ],
        true
    );

    // ── Minimoog Lead ─────────────────────────────────────────
    // 3 detuned saws through Moog ladder filter with self-oscillation
    registerFaustDSP(
        'Minimoog Lead',
        `
        import("stdfaust.lib");
        freq = hslider("freq", 440, 20, 12000, 0.01);
        gain = hslider("gain", 0.5, 0, 1, 0.01);
        gate = button("gate");
        glide = hslider("glide", 0.08, 0.001, 0.5, 0.001);
        
        lfo_rate = hslider("lfo_rate", 5, 0.1, 20, 0.1);
        lfo_depth = hslider("lfo_depth", 0, 0, 1, 0.01);
        lfo = os.osc(lfo_rate) * lfo_depth;

        sfreq = freq : si.smooth(ba.tau2pole(glide));
        mfreq = sfreq * (1 + lfo * 0.05);

        detune = hslider("detune", 7, 0, 50, 0.1);
        osc3lvl = hslider("osc3", 0.3, 0, 1, 0.01);
        
        cutoff = hslider("cutoff", 1800, 80, 18000, 1);
        mod_cutoff = cutoff * (1 + lfo * 0.5) : si.smoo;

        res = hslider("resonance", 4, 0.707, 25, 0.1) : si.smoo;
        env_amt = hslider("env_amount", 0.3, 0, 1, 0.01);
        atk = hslider("attack", 0.005, 0.001, 5, 0.001);
        dec = hslider("decay", 0.25, 0.01, 5, 0.01);
        sus = hslider("sustain", 0.6, 0, 1, 0.01);
        rel = hslider("release", 0.3, 0.01, 5, 0.01);
        spread = detune * 0.01;
        osc1 = os.sawtooth(mfreq);
        osc2 = os.sawtooth(mfreq * (1 + spread));
        osc3 = os.sawtooth(mfreq * (1 - spread * 1.5));
        mixed = (osc1 + osc2 + osc3 * osc3lvl) / 3;
        env = en.adsr(atk, dec, sus, rel, gate);
        fenv = env * env_amt;
        filtered = mixed : ve.moogLadder(min(1.0, mod_cutoff / 20000 + fenv), res);
        process = filtered * env * gain * 0.8 <: _, _;
    `,
        [
            {
                address: '/Minimoog_Lead/glide',
                label: 'Glide',
                min: 0.001,
                max: 0.5,
                defaultValue: 0.08,
                step: 0.001,
                type: 'hslider',
            },
            {
                address: '/Minimoog_Lead/lfo_rate',
                label: 'LFO Rate',
                min: 0.1,
                max: 20,
                defaultValue: 5,
                step: 0.1,
                type: 'hslider',
            },
            {
                address: '/Minimoog_Lead/lfo_depth',
                label: 'LFO Depth',
                min: 0,
                max: 1,
                defaultValue: 0,
                step: 0.01,
                type: 'hslider',
            },
            {
                address: '/Minimoog_Lead/detune',
                label: 'Osc Detune (¢)',
                min: 0,
                max: 50,
                defaultValue: 7,
                step: 0.1,
                type: 'hslider',
            },
            {
                address: '/Minimoog_Lead/osc3',
                label: 'Osc3 Level',
                min: 0,
                max: 1,
                defaultValue: 0.3,
                step: 0.01,
                type: 'hslider',
            },
            {
                address: '/Minimoog_Lead/cutoff',
                label: 'Filter Cutoff',
                min: 80,
                max: 18000,
                defaultValue: 1800,
                step: 1,
                type: 'hslider',
            },
            {
                address: '/Minimoog_Lead/resonance',
                label: 'Resonance',
                min: 0.707,
                max: 25,
                defaultValue: 4,
                step: 0.1,
                type: 'hslider',
            },
            {
                address: '/Minimoog_Lead/env_amount',
                label: 'Filter Env Amt',
                min: 0,
                max: 1,
                defaultValue: 0.3,
                step: 0.01,
                type: 'hslider',
            },
            {
                address: '/Minimoog_Lead/attack',
                label: 'Attack',
                min: 0.001,
                max: 5,
                defaultValue: 0.005,
                step: 0.001,
                type: 'hslider',
                scaling: 'log',
            },
            {
                address: '/Minimoog_Lead/decay',
                label: 'Decay',
                min: 0.01,
                max: 5,
                defaultValue: 0.25,
                step: 0.01,
                type: 'hslider',
                scaling: 'log',
            },
            {
                address: '/Minimoog_Lead/sustain',
                label: 'Sustain',
                min: 0,
                max: 1,
                defaultValue: 0.6,
                step: 0.01,
                type: 'hslider',
            },
            {
                address: '/Minimoog_Lead/release',
                label: 'Release',
                min: 0.01,
                max: 5,
                defaultValue: 0.3,
                step: 0.01,
                type: 'hslider',
                scaling: 'log',
            },
            {
                address: '/Minimoog_Lead/gain',
                label: 'Gain',
                min: 0,
                max: 1,
                defaultValue: 0.5,
                step: 0.01,
                type: 'hslider',
            },
        ],
        true
    );

    // ── Acid Bass 303 ─────────────────────────────────────────
    // Diode ladder filter for characteristic squelchy resonance
    registerFaustDSP(
        'Acid Bass 303',
        `
        import("stdfaust.lib");
        freq = hslider("freq", 200, 50, 1000, 0.01);
        gain = hslider("gain", 0.5, 0, 1, 0.01);
        gate = button("gate");
        
        lfo_rate = hslider("lfo_rate", 5, 0.1, 20, 0.1);
        lfo_depth = hslider("lfo_depth", 0, 0, 1, 0.01);
        lfo = os.osc(lfo_rate) * lfo_depth;

        cutoff = hslider("cutoff", 0.3, 0.01, 1, 0.001);
        mod_cutoff = cutoff * (1 + lfo * 0.5) : si.smoo;

        resonance = hslider("resonance", 8, 0.7, 20, 0.1) : si.smoo;
        envmod = hslider("envmod", 0.5, 0, 1, 0.01) : si.smoo;
        decay = hslider("decay", 0.15, 0.01, 1.0, 0.01);
        slide = hslider("slide", 0.06, 0.001, 0.5, 0.001);
        dist = hslider("drive", 1.0, 1.0, 5.0, 0.1);
        
        sfreq = freq : si.smooth(ba.tau2pole(slide));
        mfreq = sfreq * (1 + lfo * 0.02); // slight pitch mod
        osc_out = os.sawtooth(mfreq);
        
        accent_env = en.ar(0.003, decay, gate) * envmod;
        filtered = osc_out : ve.diodeLadder(min(1.0, mod_cutoff + accent_env), resonance);
        saturated = ma.tanh(filtered * dist);
        amp_env = en.adsr(0.003, 0.2, 0.0, 0.05, gate) * gain;
        process = saturated * amp_env <: _, _;
    `,
        [
            {
                address: '/Acid_Bass_303/lfo_rate',
                label: 'LFO Rate',
                min: 0.1,
                max: 20,
                defaultValue: 5,
                step: 0.1,
                type: 'hslider',
            },
            {
                address: '/Acid_Bass_303/lfo_depth',
                label: 'LFO Depth',
                min: 0,
                max: 1,
                defaultValue: 0,
                step: 0.01,
                type: 'hslider',
            },
            {
                address: '/Acid_Bass_303/cutoff',
                label: 'Cutoff',
                min: 0.01,
                max: 1,
                defaultValue: 0.3,
                step: 0.001,
                type: 'hslider',
                scaling: 'log',
            },
            {
                address: '/Acid_Bass_303/resonance',
                label: 'Resonance',
                min: 0.7,
                max: 20,
                defaultValue: 8,
                step: 0.1,
                type: 'hslider',
            },
            {
                address: '/Acid_Bass_303/envmod',
                label: 'Env Mod',
                min: 0,
                max: 1,
                defaultValue: 0.5,
                step: 0.01,
                type: 'hslider',
            },
            {
                address: '/Acid_Bass_303/decay',
                label: 'Decay',
                min: 0.01,
                max: 1,
                defaultValue: 0.15,
                step: 0.01,
                type: 'hslider',
                scaling: 'log',
            },
            {
                address: '/Acid_Bass_303/slide',
                label: 'Slide',
                min: 0.001,
                max: 0.5,
                defaultValue: 0.06,
                step: 0.001,
                type: 'hslider',
            },
            {
                address: '/Acid_Bass_303/drive',
                label: 'Drive',
                min: 1,
                max: 5,
                defaultValue: 1,
                step: 0.1,
                type: 'hslider',
            },
            {
                address: '/Acid_Bass_303/gain',
                label: 'Gain',
                min: 0,
                max: 1,
                defaultValue: 0.5,
                step: 0.01,
                type: 'hslider',
            },
        ],
        true
    );

    // ── LUFS Meter (ITU-R BS.1770-4) ──────────────────────────
    registerFaustDSP(
        'LUFS Meter',
        `
        import("stdfaust.lib");
        pre_a0 = 1.53512485958697; pre_a1 = -2.69169618940638;
        pre_a2 = 1.19839281085285; pre_b1 = -1.69065929318241; pre_b2 = 0.73248077421585;
        rlb_a0 = 1.0; rlb_a1 = -2.0; rlb_a2 = 1.0; rlb_b1 = -1.99004745483398; rlb_b2 = 0.99007225036621;
        kweight = fi.tf22t(pre_a0, pre_a1, pre_a2, pre_b1, pre_b2) : fi.tf22t(rlb_a0, rlb_a1, rlb_a2, rlb_b1, rlb_b2);
        ms_window(t) = ^(2) : si.smooth(ba.tau2pole(t));
        lufs(ms) = ba.if(ms > 1e-10, 10 * log10(ms) - 0.691, -70);
        momentary_ms = kweight : ms_window(0.4);
        shortterm_ms = kweight : ms_window(3.0);
        meter_ch(x) = x <: (_, momentary_ms, shortterm_ms) : (_, vbargraph("momentary", -70, 0), vbargraph("short_term", -70, 0));
        process = meter_ch, meter_ch;
    `,
        [
            {
                address: '/LUFS_Meter/momentary',
                label: 'Momentary (LUFS)',
                min: -70,
                max: 0,
                defaultValue: -70,
                step: 0.1,
                type: 'vbargraph',
            },
            {
                address: '/LUFS_Meter/short_term',
                label: 'Short-Term (LUFS)',
                min: -70,
                max: 0,
                defaultValue: -70,
                step: 0.1,
                type: 'vbargraph',
            },
        ]
    );

    // ── Stereo Widener (M/S) ──────────────────────────────────
    registerFaustDSP(
        'Stereo Widener',
        `
        import("stdfaust.lib");
        width = hslider("width", 100, 0, 200, 1) / 100.0;
        mono_freq = hslider("mono_bass", 0, 0, 500, 1);
        mid(l, r) = (l + r) * 0.5;
        side(l, r) = (l - r) * 0.5;
        bass_mono(m, s) = m, (s * ba.if(mono_freq > 1, 1.0 - (fi.lowpass(1, mono_freq) : abs : si.smooth(0.999)), 1.0));
        process(l, r) = mid(l,r), side(l,r) : bass_mono : (*(1.0), *(width)) : (+(_, _), -(_, _));
    `,
        [
            {
                address: '/Stereo_Widener/width',
                label: 'Width (%)',
                min: 0,
                max: 200,
                defaultValue: 100,
                step: 1,
                type: 'hslider',
            },
            {
                address: '/Stereo_Widener/mono_bass',
                label: 'Mono Bass (Hz)',
                min: 0,
                max: 500,
                defaultValue: 0,
                step: 1,
                type: 'hslider',
            },
        ]
    );

    // ── De-esser ──────────────────────────────────────────────
    registerFaustDSP(
        'De-esser',
        `
        import("stdfaust.lib");
        freq = hslider("frequency", 6000, 2000, 12000, 10);
        bw = hslider("bandwidth", 2.0, 0.5, 6.0, 0.1);
        thresh = hslider("threshold", -20, -60, 0, 0.5);
        ratio = hslider("ratio", 4, 1, 20, 0.5);
        atk = 0.001; rel = 0.05;
        listen = checkbox("listen");
        sc_signal = fi.resonbp(freq, bw, 1);
        env = sc_signal : abs : si.smooth(ba.tau2pole(atk)) : max(_, _ : si.smooth(ba.tau2pole(rel)));
        gr(e) = ba.if(e > ba.db2linear(thresh), pow(ba.db2linear(thresh) / e, 1 - 1.0/ratio), 1.0);
        deess(x) = x <: (sc_signal, _) : (env : gr, _) : select2(listen, *(_, _), (sc_signal));
        process = deess, deess;
    `,
        [
            {
                address: '/De-esser/frequency',
                label: 'Frequency (Hz)',
                min: 2000,
                max: 12000,
                defaultValue: 6000,
                step: 10,
                type: 'hslider',
            },
            {
                address: '/De-esser/bandwidth',
                label: 'Bandwidth (Q)',
                min: 0.5,
                max: 6.0,
                defaultValue: 2.0,
                step: 0.1,
                type: 'hslider',
            },
            {
                address: '/De-esser/threshold',
                label: 'Threshold (dB)',
                min: -60,
                max: 0,
                defaultValue: -20,
                step: 0.5,
                type: 'hslider',
            },
            {
                address: '/De-esser/ratio',
                label: 'Ratio',
                min: 1,
                max: 20,
                defaultValue: 4,
                step: 0.5,
                type: 'hslider',
            },
            {
                address: '/De-esser/listen',
                label: 'Listen (Solo SC)',
                min: 0,
                max: 1,
                defaultValue: 0,
                step: 1,
                type: 'checkbox',
            },
        ]
    );
}
