/**
 * Factory preset library — all built-in Sound presets for the Sourdaw project.
 *
 * This file is a thin barrel. Presets are organized by instrument category in
 * the `./presets/` sub-directory. Large cross-category data (expanded FX chains,
 * faust-replacement instruments) are imported from their own dedicated files.
 *
 * To add a new preset, add it to the appropriate category file under ./presets/.
 */

import { type SoundPreset } from '../../models/SoundPreset';

import { bassPresets } from './bassPresets';
import { EXPANDED_FX_PRESETS, EXPANDED_SYNTH_PRESETS } from './expandedPresets';
import { FAUST_EFFECT_PRESETS } from './faustEffectPresets';
import { FAUST_INSTRUMENT_PRESETS } from './faustInstrumentPresets';
import { keysPresets } from './keysPresets';
import { leadPresets } from './leadPresets';
import { padPresets } from './padPresets';
import { comp } from './presetHelpers/comp';
import { eq } from './presetHelpers/eq';
import { AUTHOR } from './presetHelpers/helpers';
import { reverb } from './presetHelpers/reverb';
import { stringsPresets } from './stringsPresets';

const DRUM_KIT_PRESETS: SoundPreset[] = [
    {
        id: 'factory-drumkit-808',
        name: '808 Kit',
        category: 'drums',
        subcategory: 'electronic',
        description: 'Classic 808-style drum kit with deep kick, snappy snare, and crisp hats',
        trackKind: 'midi',
        devices: [
            { type: 'builtin-drum-kit', name: '808 Kit', parameterValues: { kit: 0 } },
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
            { type: 'builtin-drum-kit', name: 'Analog Kit', parameterValues: { kit: 1 } },
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
            { type: 'builtin-drum-kit', name: 'Electronic Kit', parameterValues: { kit: 2 } },
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
            { type: 'builtin-drum-kit', name: 'Acoustic Kit', parameterValues: { kit: 3 } },
            reverb('Room', { 'rev-size': 0.3, 'rev-decay': 1.2, 'rev-mix': 0.15 }),
            eq('Natural EQ', { 'eq-low-gain': 2, 'eq-low-freq': 100, 'eq-mid-gain': -1, 'eq-mid-freq': 500 }),
        ],
        tags: ['acoustic', 'natural', 'room', 'drum-kit'],
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
    // Single inclusion point for the drum kits. They are deliberately not
    // exported separately: a second export let the library concatenate them
    // on top of this aggregate, duplicating their ids (audit M-020).
    ...DRUM_KIT_PRESETS,
    ...EXPANDED_FX_PRESETS,
    ...EXPANDED_SYNTH_PRESETS,
    ...FAUST_INSTRUMENT_PRESETS,
    ...FAUST_EFFECT_PRESETS,
];
