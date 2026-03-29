/**
 * Factory preset library — all built-in Sound presets for the Sourdaw project.
 *
 * This file is a thin barrel. Presets are organized by instrument category in
 * the `./presets/` sub-directory. Large cross-category data (expanded FX chains,
 * faust-replacement instruments) are imported from their own dedicated files.
 *
 * To add a new preset, add it to the appropriate category file under ./presets/.
 */

import { type SoundPreset } from '#/modules/Arrangement/models/SoundPreset';

// ── Category sub-modules ───────────────────────────────────────────────────
import { bassPresets } from './bassPresets';
import { leadPresets } from './leadPresets';
import { padPresets } from './padPresets';
import { keysPresets } from './keysPresets';
import { stringsPresets } from './stringsPresets';

// ── Standalone data files (unchanged — each already < 300 lines) ──────────
import { EXPANDED_FX_PRESETS, EXPANDED_SYNTH_PRESETS } from './expandedPresets';
import { FAUST_INSTRUMENT_PRESETS } from './faustInstrumentPresets';
import { FERMENTER_PRESETS } from '#/modules/Fermenter/useCases/fermenterQueries';

// ── Drum Kit presets ────────────────────────────────────────────────────────
// Small enough to stay inline here (< 60 lines).
import { type DevicePreset } from '#/modules/Arrangement/models/SoundPreset';
import { comp, eq, reverb, synth, AUTHOR } from './presetHelpers';

const DRUM_KIT_PRESETS: SoundPreset[] = [
    {
        id: 'factory-drumkit-808',
        name: '808 Kit',
        category: 'drums',
        subcategory: 'electronic',
        description: 'Classic 808-style drum kit with deep kick, snappy snare, and crisp hats',
        trackKind: 'midi',
        devices: [
            { type: 'builtin-drum-kit', name: '808 Kit', parameterValues: { kit: 0 } } as DevicePreset,
            comp('Drum Comp', { 'comp-threshold': -15, 'comp-ratio': 4, 'comp-attack': 1, 'comp-release': 80 }),
        ],
        tags: ['808', 'trap', 'hip-hop', 'electronic', 'drum-kit'],
        author: AUTHOR,
        isFactory: true,
    },
    {
        id: 'factory-drumkit-analog',
        name: 'Analog Kit',
        category: 'drums',
        subcategory: 'analog',
        description: 'Warm analog-style drum kit with round kick and soft hats',
        trackKind: 'midi',
        devices: [
            { type: 'builtin-drum-kit', name: 'Analog Kit', parameterValues: { kit: 1 } } as DevicePreset,
            eq('Drum EQ', { 'eq-low-gain': 3, 'eq-low-freq': 80, 'eq-high-gain': 2, 'eq-high-freq': 10000 }),
        ],
        tags: ['analog', 'vintage', 'warm', 'drum-kit'],
        author: AUTHOR,
        isFactory: true,
    },
    {
        id: 'factory-drumkit-electronic',
        name: 'Electronic Kit',
        category: 'drums',
        subcategory: 'electronic',
        description: 'Aggressive electronic drum kit with high resonance and punchy transients',
        trackKind: 'midi',
        devices: [
            { type: 'builtin-drum-kit', name: 'Electronic Kit', parameterValues: { kit: 2 } } as DevicePreset,
            comp('Punch Comp', { 'comp-threshold': -10, 'comp-ratio': 6, 'comp-attack': 0.5, 'comp-release': 60 }),
            eq('Presence EQ', { 'eq-mid-gain': 3, 'eq-mid-freq': 3000, 'eq-high-gain': 4, 'eq-high-freq': 8000 }),
        ],
        tags: ['electronic', 'edm', 'aggressive', 'drum-kit'],
        author: AUTHOR,
        isFactory: true,
    },
    {
        id: 'factory-drumkit-acoustic',
        name: 'Acoustic Kit',
        category: 'drums',
        subcategory: 'acoustic',
        description: 'Natural-sounding synthesized acoustic drum kit with room character',
        trackKind: 'midi',
        devices: [
            { type: 'builtin-drum-kit', name: 'Acoustic Kit', parameterValues: { kit: 3 } } as DevicePreset,
            reverb('Room', { 'rev-size': 0.3, 'rev-decay': 1.2, 'rev-mix': 0.15 }),
            eq('Natural EQ', { 'eq-low-gain': 2, 'eq-low-freq': 100, 'eq-mid-gain': -1, 'eq-mid-freq': 500 }),
        ],
        tags: ['acoustic', 'natural', 'room', 'drum-kit'],
        author: AUTHOR,
        isFactory: true,
    },
];

// ── FX presets that use native DSP devices ──────────────────────────────────
// These use `native-*` device types so they can't share the builtin helpers.
// They're inlined here to avoid creating another file for just ~8 presets.
const nativeEq = (
    name: string,
    params: Partial<
        Record<
            | 'band2_freq'
            | 'band2_gain'
            | 'band2_q'
            | 'band3_freq'
            | 'band3_gain'
            | 'band3_q'
            | 'band4_freq'
            | 'band4_gain'
            | 'band4_q'
            | 'band5_freq'
            | 'band5_gain'
            | 'band5_q'
            | 'output_gain',
            number
        >
    >
): DevicePreset => ({
    type: 'native-eq',
    name,
    parameterValues: {
        band2_freq: 250,
        band2_gain: 0,
        band2_q: 1,
        band3_freq: 800,
        band3_gain: 0,
        band3_q: 1,
        band4_freq: 2500,
        band4_gain: 0,
        band4_q: 1,
        band5_freq: 6000,
        band5_gain: 0,
        band5_q: 1,
        output_gain: 0,
        ...params,
    },
});

const nativeComp = (
    name: string,
    params: Partial<Record<'threshold' | 'ratio' | 'attack' | 'release' | 'knee' | 'makeup' | 'mix', number>>
): DevicePreset => ({
    type: 'native-compressor',
    name,
    parameterValues: { threshold: -18, ratio: 4, attack: 0.01, release: 0.1, knee: 6, makeup: 0, mix: 1, ...params },
});

const nativeReverb = (
    name: string,
    params: Partial<Record<'mix' | 'size' | 'decay' | 'damping' | 'predelay', number>>
): DevicePreset => ({
    type: 'native-reverb',
    name,
    parameterValues: { mix: 0.3, size: 0.7, decay: 0.7, damping: 0.5, predelay: 20, ...params },
});

const nativeDelay = (
    name: string,
    params: Partial<Record<'time_l' | 'time_r' | 'feedback' | 'mix' | 'filter' | 'ping_pong', number>>
): DevicePreset => ({
    type: 'native-delay',
    name,
    parameterValues: { time_l: 0.25, time_r: 0.375, feedback: 0.4, mix: 0.3, filter: 8000, ping_pong: 0, ...params },
});

const nativeGate = (
    name: string,
    params: Partial<Record<'threshold' | 'attack' | 'hold' | 'release' | 'range', number>>
): DevicePreset => ({
    type: 'native-gate',
    name,
    parameterValues: { threshold: -40, attack: 0.001, hold: 0.05, release: 0.1, range: -80, ...params },
});

const nativeLimiter = (
    name: string,
    params: Partial<Record<'ceiling' | 'release' | 'lookahead', number>>
): DevicePreset => ({
    type: 'native-limiter',
    name,
    parameterValues: { ceiling: -0.3, release: 0.05, lookahead: 5, ...params },
});

const nativeGain = (
    name: string,
    params: Partial<Record<'gain' | 'pan' | 'phase_l' | 'phase_r' | 'mono' | 'width' | 'dc_block', number>>
): DevicePreset => ({
    type: 'native-gain',
    name,
    parameterValues: { gain: 0, pan: 0, phase_l: 0, phase_r: 0, mono: 0, width: 1, dc_block: 0, ...params },
});

const NATIVE_DSP_PRESETS: SoundPreset[] = [
    {
        id: 'factory-native-mastering-chain',
        name: 'Mastering Chain',
        category: 'fx',
        subcategory: 'mastering',
        description: 'Professional mastering chain: parametric EQ → compressor → limiter.',
        trackKind: 'audio',
        devices: [
            nativeEq('Mastering EQ', {
                band2_freq: 60,
                band2_gain: 1.5,
                band2_q: 0.7,
                band4_freq: 3000,
                band4_gain: 1,
                band4_q: 0.8,
            }),
            nativeComp('Glue Comp', { threshold: -12, ratio: 2, attack: 0.03, release: 0.2, knee: 10, makeup: 2 }),
            nativeLimiter('Ceiling Limiter', { ceiling: -0.3, release: 0.05, lookahead: 5 }),
        ],
        tags: ['mastering', 'chain', 'professional', 'native'],
        author: AUTHOR,
        isFactory: true,
    },
    {
        id: 'factory-native-vocal-chain',
        name: 'Vocal Chain',
        category: 'fx',
        subcategory: 'vocal',
        description: 'Gate → EQ → compressor → reverb — ready for vocals.',
        trackKind: 'audio',
        devices: [
            nativeGate('Gate', { threshold: -35, attack: 0.001, hold: 0.05, release: 0.1 }),
            nativeEq('Vocal EQ', {
                band2_freq: 120,
                band2_gain: -4,
                band2_q: 0.7,
                band3_freq: 2500,
                band3_gain: 2,
                band3_q: 1.2,
                band5_freq: 10000,
                band5_gain: 2,
                band5_q: 0.5,
            }),
            nativeComp('Vocal Comp', { threshold: -20, ratio: 3, attack: 0.005, release: 0.08, knee: 6, makeup: 4 }),
            nativeReverb('Plate Reverb', { mix: 0.15, size: 0.5, decay: 0.6, damping: 0.5, predelay: 30 }),
        ],
        tags: ['vocal', 'chain', 'gate', 'eq', 'compressor', 'reverb'],
        author: AUTHOR,
        isFactory: true,
    },
    {
        id: 'factory-native-bass-processing',
        name: 'Bass Processing',
        category: 'bass',
        subcategory: 'analog',
        description: 'Sub-bass focused EQ with compression for tight low-end.',
        trackKind: 'midi',
        devices: [
            synth('Bass', {
                waveform: 2,
                attack: 0.005,
                decay: 0.2,
                sustain: 0.6,
                release: 0.15,
                filterCutoff: 600,
                filterResonance: 1,
                filterType: 0,
                gain: 0.35,
                subOscLevel: 0.4,
            }),
            nativeEq('Bass EQ', {
                band2_freq: 60,
                band2_gain: 3,
                band2_q: 0.8,
                band3_freq: 200,
                band3_gain: -2,
                band3_q: 1.5,
                band5_freq: 3000,
                band5_gain: 1,
                band5_q: 0.7,
            }),
            nativeComp('Bass Comp', { threshold: -15, ratio: 6, attack: 0.003, release: 0.06, knee: 3, makeup: 3 }),
        ],
        tags: ['bass', 'eq', 'compression', 'sub', 'native'],
        author: AUTHOR,
        isFactory: true,
    },
    {
        id: 'factory-native-ambient-texture',
        name: 'Ambient Texture',
        category: 'pad',
        subcategory: 'digital',
        description: 'Lush pad with native reverb and ping-pong delay for ambient soundscapes.',
        trackKind: 'midi',
        devices: [
            synth('Ambient Pad', {
                waveform: 0,
                attack: 0.8,
                decay: 0.5,
                sustain: 0.9,
                release: 3.0,
                filterCutoff: 3000,
                filterResonance: 0.5,
                filterType: 0,
                gain: 0.2,
                osc2Waveform: 1,
                osc2Mix: 0.4,
                osc2Detune: 5,
                stereoSpread: 0.8,
            }),
            nativeReverb('Hall Reverb', { mix: 0.6, size: 0.9, decay: 0.9, damping: 0.3, predelay: 40 }),
            nativeDelay('Ping-Pong', {
                time_l: 0.375,
                time_r: 0.5,
                feedback: 0.45,
                mix: 0.25,
                filter: 6000,
                ping_pong: 1,
            }),
        ],
        tags: ['ambient', 'texture', 'reverb', 'delay', 'pad', 'native'],
        author: AUTHOR,
        isFactory: true,
    },
    {
        id: 'factory-native-drum-bus',
        name: 'Drum Bus',
        category: 'fx',
        subcategory: 'mixing',
        description: 'Punchy drum bus: EQ scoop → aggressive compressor → limiter.',
        trackKind: 'audio',
        devices: [
            nativeEq('Drum EQ', {
                band2_freq: 100,
                band2_gain: 2,
                band2_q: 0.7,
                band3_freq: 400,
                band3_gain: -3,
                band3_q: 1.5,
                band4_freq: 4000,
                band4_gain: 2,
                band4_q: 0.8,
            }),
            nativeComp('Drum Comp', {
                threshold: -14,
                ratio: 6,
                attack: 0.002,
                release: 0.05,
                knee: 3,
                makeup: 4,
                mix: 0.7,
            }),
            nativeLimiter('Safety Limiter', { ceiling: -0.5, release: 0.03 }),
        ],
        tags: ['drums', 'bus', 'punch', 'compression', 'native'],
        author: AUTHOR,
        isFactory: true,
    },
    {
        id: 'factory-native-stereo-widener',
        name: 'Stereo Widener',
        category: 'fx',
        subcategory: 'utility',
        description: 'Mid-side stereo widening with DC block.',
        trackKind: 'audio',
        devices: [nativeGain('Widener', { width: 1.6, dc_block: 1 })],
        tags: ['stereo', 'wide', 'utility', 'native'],
        author: AUTHOR,
        isFactory: true,
    },
    {
        id: 'factory-native-warm-saturation',
        name: 'Warm Saturation',
        category: 'fx',
        subcategory: 'analog',
        description: 'Gentle EQ warmth with parallel compression for analog feel.',
        trackKind: 'audio',
        devices: [
            nativeEq('Warmth EQ', {
                band2_freq: 120,
                band2_gain: 2,
                band2_q: 0.5,
                band5_freq: 8000,
                band5_gain: -1,
                band5_q: 0.6,
                output_gain: 1,
            }),
            nativeComp('Parallel Comp', {
                threshold: -25,
                ratio: 8,
                attack: 0.001,
                release: 0.05,
                knee: 3,
                makeup: 6,
                mix: 0.3,
            }),
        ],
        tags: ['warm', 'saturation', 'analog', 'parallel', 'native'],
        author: AUTHOR,
        isFactory: true,
    },
    {
        id: 'factory-native-de-esser',
        name: 'De-esser',
        category: 'fx',
        subcategory: 'vocal',
        description: 'High-frequency surgical cut with narrow Q for sibilance control.',
        trackKind: 'audio',
        devices: [
            nativeEq('De-ess EQ', {
                band4_freq: 6000,
                band4_gain: -6,
                band4_q: 4,
                band5_freq: 8000,
                band5_gain: -3,
                band5_q: 3,
            }),
        ],
        tags: ['de-esser', 'sibilance', 'vocal', 'eq', 'native'],
        author: AUTHOR,
        isFactory: true,
    },
    {
        id: 'factory-native-lofi-delay',
        name: 'Lo-Fi Delay',
        category: 'fx',
        subcategory: 'digital',
        description: 'Dark filtered delay with high feedback for dub/lo-fi textures.',
        trackKind: 'midi',
        devices: [
            synth('Lo-Fi Pad', {
                waveform: 1,
                attack: 0.3,
                decay: 0.4,
                sustain: 0.7,
                release: 1.5,
                filterCutoff: 1500,
                filterResonance: 1,
                filterType: 0,
                gain: 0.25,
            }),
            nativeDelay('Dub Delay', {
                time_l: 0.375,
                time_r: 0.5,
                feedback: 0.65,
                mix: 0.4,
                filter: 2000,
                ping_pong: 0,
            }),
            nativeEq('Darken', { band5_freq: 4000, band5_gain: -6, band5_q: 0.5 }),
        ],
        tags: ['lofi', 'delay', 'dub', 'dark', 'filtered', 'native'],
        author: AUTHOR,
        isFactory: true,
    },
];

// ── Aggregated exports ─────────────────────────────────────────────────────

/**
 * Complete factory preset library.
 * Imported by the SoundLibrary module to populate the preset browser.
 */
export const FACTORY_PRESETS: SoundPreset[] = [
    ...bassPresets,
    ...leadPresets,
    ...padPresets,
    ...keysPresets,
    ...stringsPresets,
    ...DRUM_KIT_PRESETS,
    ...NATIVE_DSP_PRESETS,
    ...EXPANDED_FX_PRESETS,
    ...EXPANDED_SYNTH_PRESETS,
    ...FAUST_INSTRUMENT_PRESETS,
    ...FERMENTER_PRESETS,
];

export { DRUM_KIT_PRESETS };
