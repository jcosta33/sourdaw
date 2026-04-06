/**
 * Built-in Grand Boule preset catalog.
 *
 * This is the static, shipped set. User presets, favourites, and I/O
 * against storage belong in separate repository files when they are needed.
 */

import { type GrandBoulePreset } from '../models/GrandBoulePreset';

const BUILTIN_PRESETS: readonly GrandBoulePreset[] = [
    {
        id: 'grand-boule-classic',
        name: 'Classic Miche',
        description: 'Balanced concert grand tone — neutral hammer, moderate stereo.',
        parameters: {
            hammerHardness: 0.0,
            velocityCurve: 1.0,
            stereoWidth: 0.6,
            toneTilt: 0.0,
        },
    },
    {
        id: 'grand-boule-warm',
        name: 'Warm Crumb',
        description: 'Softer hammers, tilted dark — ballad and solo recordings.',
        parameters: {
            hammerHardness: -0.35,
            velocityCurve: 1.2,
            stereoWidth: 0.45,
            toneTilt: -0.3,
        },
    },
    {
        id: 'grand-boule-bright',
        name: 'Bright Crust',
        description: 'Harder hammers, tilted bright — pop and rock tracking.',
        parameters: {
            hammerHardness: 0.4,
            velocityCurve: 0.85,
            stereoWidth: 0.7,
            toneTilt: 0.35,
        },
    },
];

export const listBuiltinGrandBoulePresets = (): readonly GrandBoulePreset[] => BUILTIN_PRESETS;
