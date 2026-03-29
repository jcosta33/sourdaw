import { type PluginDescriptor } from '../DeviceParameter';

/**
 * Plugin descriptors for Faust DSP effects.
 *
 * These correspond to the Faust modules registered in builtinDSP.ts.
 * Parameters are intentionally empty here — the real parameter descriptors
 * are populated at runtime by the Faust compiler after compilation.
 * The inspector uses FaustInstrumentLayout (prefix match on 'faust-')
 * which reads parameters dynamically from the compiled Faust node.
 */
export const FAUST_EFFECT_DESCRIPTORS: PluginDescriptor[] = [
    {
        id: 'faust-zita-rev1-reverb',
        name: 'Zita-Rev1 Reverb',
        vendor: 'Faust/Sourdaw',
        format: 'builtin',
        category: 'effect',
        hasCustomUI: false,
        parameters: [],
    },
    {
        id: 'faust-1176-compressor',
        name: '1176 Compressor',
        vendor: 'Faust/Sourdaw',
        format: 'builtin',
        category: 'effect',
        hasCustomUI: false,
        parameters: [],
    },
    {
        id: 'faust-multiband-compressor',
        name: 'Multiband Compressor',
        vendor: 'Faust/Sourdaw',
        format: 'builtin',
        category: 'effect',
        hasCustomUI: false,
        parameters: [],
    },
    {
        id: 'faust-pro-parametric-eq',
        name: 'Pro Parametric EQ',
        vendor: 'Faust/Sourdaw',
        format: 'builtin',
        category: 'effect',
        hasCustomUI: false,
        parameters: [],
    },
    {
        id: 'faust-tape-delay',
        name: 'Tape Delay',
        vendor: 'Faust/Sourdaw',
        format: 'builtin',
        category: 'effect',
        hasCustomUI: false,
        parameters: [],
    },
    {
        id: 'faust-brick-wall-limiter',
        name: 'Brick-Wall Limiter',
        vendor: 'Faust/Sourdaw',
        format: 'builtin',
        category: 'effect',
        hasCustomUI: false,
        parameters: [],
    },
    {
        id: 'faust-spring-reverb',
        name: 'Spring Reverb',
        vendor: 'Faust/Sourdaw',
        format: 'builtin',
        category: 'effect',
        hasCustomUI: false,
        parameters: [],
    },
    {
        id: 'faust-noise-gate',
        name: 'Noise Gate',
        vendor: 'Faust/Sourdaw',
        format: 'builtin',
        category: 'effect',
        hasCustomUI: false,
        parameters: [],
    },
    {
        id: 'faust-gain-utility',
        name: 'Gain Utility',
        vendor: 'Faust/Sourdaw',
        format: 'builtin',
        category: 'utility',
        hasCustomUI: false,
        parameters: [],
    },
    {
        id: 'faust-lufs-meter',
        name: 'LUFS Meter',
        vendor: 'Faust/Sourdaw',
        format: 'builtin',
        category: 'analyzer',
        hasCustomUI: false,
        parameters: [],
    },
    {
        id: 'faust-stereo-widener',
        name: 'Stereo Widener',
        vendor: 'Faust/Sourdaw',
        format: 'builtin',
        category: 'utility',
        hasCustomUI: false,
        parameters: [],
    },
    {
        id: 'faust-de-esser',
        name: 'De-esser',
        vendor: 'Faust/Sourdaw',
        format: 'builtin',
        category: 'effect',
        hasCustomUI: false,
        parameters: [],
    },
];
