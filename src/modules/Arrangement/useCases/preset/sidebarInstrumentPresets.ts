import { type SoundPreset } from '../../models/SoundPreset';

/**
 * Sidebar instrument shortcuts are catalog entries, not presentation-owned
 * device writes. Keeping them here lets the command compiler materialize and
 * validate them exactly like every saved or factory preset.
 */
export const SIDEBAR_INSTRUMENT_PRESETS: readonly SoundPreset[] = Object.freeze([
    {
        id: 'fermenter-default',
        name: 'Fermenter',
        category: 'synth',
        description: 'Fermenter synthesizer',
        trackKind: 'midi',
        devices: [{ type: 'fermenter', name: 'Fermenter', parameterValues: {} }],
        tags: ['synth', 'wavetable', 'analog'],
        author: 'Sourdaw',
        isFactory: true,
    },
    {
        id: 'levain-default',
        name: 'Levain',
        category: 'keys',
        description: 'Levain instrument',
        trackKind: 'midi',
        devices: [{ type: 'levain', name: 'Levain', parameterValues: {} }],
        tags: ['levain', 'strings', 'brass', 'woodwinds'],
        author: 'Sourdaw',
        isFactory: true,
    },
    {
        id: 'sampler-default',
        name: 'Sampler',
        category: 'keys',
        description: 'Unified Sampler Suite',
        trackKind: 'midi',
        devices: [{ type: 'builtin-sampler', name: 'Sampler', parameterValues: {} }],
        tags: ['sampler', 'sample', 'playback'],
        author: 'Sourdaw',
        isFactory: true,
    },
]);
