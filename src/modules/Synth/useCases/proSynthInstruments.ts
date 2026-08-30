/**
 * Pro Synth Instruments (Faust-based).
 * DSP definitions for professional synthesizer instruments.
 *
 * NOTE: FM Synth and Rhodes are registered in faustEngine.ts — do NOT re-register here.
 */

import { registerFaustDSP } from '#/modules/PluginHost/useCases';

import additiveSynthDsp from './dsp/additive-synth.dsp?raw';
import morphingSynthDsp from './dsp/morphing-synth.dsp?raw';
import physicalModelStringDsp from './dsp/physical-model-string.dsp?raw';
import supersawUnisonDsp from './dsp/supersaw-unison.dsp?raw';

/**
 * Register all pro synth instruments.
 */
export function registerProSynthInstruments(): void {
    // Morphing Synth — morph crossfade across 4 waveforms with ADSR
    registerFaustDSP(
        'Morphing Synth',
        morphingSynthDsp,
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
        supersawUnisonDsp,
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

            // Note-level controls the compiled node also exposes; copied from
            // the .dsp so the registration covers every input control, not
            // only the timbre and envelope blocks.
            {
                address: '/supersaw/freq',
                label: 'Freq',
                min: 20,
                max: 12000,
                defaultValue: 440,
                step: 0.01,
                type: 'hslider',
            },
            { address: '/supersaw/gate', label: 'Gate', min: 0, max: 1, defaultValue: 0, step: 1, type: 'button' },
        ],
        true
    );

    // Physical Modeling — Karplus-Strong string with excitation, damping, body controls
    registerFaustDSP(
        'Physical Model String',
        physicalModelStringDsp,
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

    // Additive Synth — the compiled node exposes exactly rolloff, gain, freq
    // and gate: this DSP hardcodes its ADSR (en.adsr literals) and partial
    // count (`partials = 16`), so the envelope, partials and spread rows the
    // registration used to carry were phantom addresses no compiled parameter
    // answered — authored values that never reached the audio. The
    // registration now mirrors the compiled node control for control.
    registerFaustDSP(
        'Additive Synth',
        additiveSynthDsp,
        [
            {
                address: '/additive/rolloff',
                label: 'Harmonic Rolloff',
                min: 0.5,
                max: 4,
                defaultValue: 1.5,
                step: 0.01,
                type: 'hslider',
            },
            { address: '/additive/gain', label: 'Gain', min: 0, max: 1, defaultValue: 1, step: 0.01, type: 'hslider' },
            {
                address: '/additive/freq',
                label: 'Freq',
                min: 20,
                max: 12000,
                defaultValue: 440,
                step: 0.01,
                type: 'hslider',
            },
            { address: '/additive/gate', label: 'Gate', min: 0, max: 1, defaultValue: 0, step: 1, type: 'button' },
        ],
        true
    );
}
