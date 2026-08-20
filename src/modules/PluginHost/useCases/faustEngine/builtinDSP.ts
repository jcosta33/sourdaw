/**
 * Built-in Faust DSP definitions.
 *
 * Each call to registerFaustDSP registers a Faust source + parameter descriptors
 * that can be compiled to WASM AudioWorkletNodes on demand.
 *
 * This file is ~900 lines of DSP source code and param descriptors.
 * Extracted from faustEngine.ts for maintainability.
 */

import compressor1176Dsp from './dsp/1176-compressor.dsp?raw';
import acidBass303Dsp from './dsp/acid-bass-303.dsp?raw';
import brickWallLimiterDsp from './dsp/brick-wall-limiter.dsp?raw';
import deEsserDsp from './dsp/de-esser.dsp?raw';
import fmSynthDsp from './dsp/fm-synth.dsp?raw';
import gainUtilityDsp from './dsp/gain-utility.dsp?raw';
import hammondB3Dsp from './dsp/hammond-b3.dsp?raw';
import lufsMeterDsp from './dsp/lufs-meter.dsp?raw';
import minimoogLeadDsp from './dsp/minimoog-lead.dsp?raw';
import multibandCompressorDsp from './dsp/multiband-compressor.dsp?raw';
import noiseGateDsp from './dsp/noise-gate.dsp?raw';
import proParametricEqDsp from './dsp/pro-parametric-eq.dsp?raw';
import rhodesDsp from './dsp/rhodes.dsp?raw';
import springReverbDsp from './dsp/spring-reverb.dsp?raw';
import stereoWidenerDsp from './dsp/stereo-widener.dsp?raw';
import tapeDelayDsp from './dsp/tape-delay.dsp?raw';
import zitaRev1Dsp from './dsp/zita-rev1.dsp?raw';
import { registerFaustDSP } from './registerFaustDSP';

export function registerBuiltinFaustDSP(): void {
    // ── Zita-Rev1 algorithmic reverb ──────────────────────────
    registerFaustDSP('Zita-Rev1 Reverb', zitaRev1Dsp, [
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
    ]);

    // ── 1176 compressor model ─────────────────────────────────
    registerFaustDSP('1176 Compressor', compressor1176Dsp, [
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
    ]);

    // ── Multiband compressor ──────────────────────────────────
    registerFaustDSP('Multiband Compressor', multibandCompressorDsp, [
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
    ]);

    // ── Pro Parametric EQ ─────────────────────────────────────
    registerFaustDSP('Pro Parametric EQ', proParametricEqDsp, [
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
    ]);

    // ── Tape Delay ────────────────────────────────────────────
    registerFaustDSP('Tape Delay', tapeDelayDsp, [
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
            address: '/tape_delay/dry_wet',
            label: 'Dry/Wet',
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
    ]);

    // ── Brick-Wall Limiter ────────────────────────────────────
    registerFaustDSP('Brick-Wall Limiter', brickWallLimiterDsp, [
        {
            address: '/limiter/ceiling',
            label: 'Ceiling (dB)',
            min: -12,
            max: 0,
            defaultValue: -0.3,
            step: 0.1,
            type: 'hslider',
        },
        {
            address: '/limiter/release',
            label: 'Release (ms)',
            min: 1,
            max: 1000,
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
            step: 0.1,
            type: 'hslider',
        },
    ]);

    // ── Spring Reverb ─────────────────────────────────────────
    registerFaustDSP('Spring Reverb', springReverbDsp, [
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
    ]);

    // ══════════════════════════════════════════════════════════
    // ██  INSTRUMENTS  ████████████████████████████████████████
    // ══════════════════════════════════════════════════════════

    // ── FM Synth ──────────────────────────────────────────────
    registerFaustDSP(
        'FM Synth',
        fmSynthDsp,
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
    // Body/bell dual-envelope FM architecture
    registerFaustDSP(
        'Rhodes',
        rhodesDsp,
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
    registerFaustDSP('Noise Gate', noiseGateDsp, [
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
    ]);

    // ── Gain Utility ──────────────────────────────────────────
    registerFaustDSP('Gain Utility', gainUtilityDsp, [
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
    ]);

    // ── Hammond B3 Organ ──────────────────────────────────────
    // 9 drawbar tonewheel synthesis + key click + percussion + Leslie
    registerFaustDSP(
        'Hammond B3',
        hammondB3Dsp,
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
        minimoogLeadDsp,
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
        acidBass303Dsp,
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
    registerFaustDSP('LUFS Meter', lufsMeterDsp, [
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
    ]);

    // ── Stereo Widener (M/S) ──────────────────────────────────
    registerFaustDSP('Stereo Widener', stereoWidenerDsp, [
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
    ]);

    // ── De-esser ──────────────────────────────────────────────
    registerFaustDSP('De-esser', deEsserDsp, [
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
    ]);
}
