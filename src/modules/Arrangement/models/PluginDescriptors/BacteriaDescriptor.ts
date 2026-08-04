/**
 * Bacteria — creative multi-effects framework plugin descriptor.
 * Registers Bacteria as an effect that can be added to any track.
 *
 * Parameter data is inlined here rather than imported from the Bacteria
 * module. Models must not cross module boundaries; duplication is intentional.
 */

import { type PluginDescriptor, type PluginParamDef } from '../DeviceParameterTypes';

const BACTERIA_PARAMS: readonly PluginParamDef[] = [
    // Global
    { id: 'mix', label: 'Mix', min: 0, max: 1, default: 1, unit: '', step: 0.01 },
    { id: 'inputGain', label: 'Input', min: -24, max: 24, default: 0, unit: 'dB', step: 0.5 },
    { id: 'outputGain', label: 'Output', min: -24, max: 24, default: 0, unit: 'dB', step: 0.5 },

    // Crossover
    { id: 'bandCount', label: 'Bands', min: 1, max: 6, default: 1, unit: '', step: 1 },
    { id: 'crossoverFreq1', label: 'XOver 1', min: 20, max: 20000, default: 200, unit: 'Hz', step: 1, scaling: 'log' },
    { id: 'crossoverFreq2', label: 'XOver 2', min: 20, max: 20000, default: 800, unit: 'Hz', step: 1, scaling: 'log' },
    { id: 'crossoverFreq3', label: 'XOver 3', min: 20, max: 20000, default: 2500, unit: 'Hz', step: 1, scaling: 'log' },
    { id: 'crossoverFreq4', label: 'XOver 4', min: 20, max: 20000, default: 6000, unit: 'Hz', step: 1, scaling: 'log' },
    {
        id: 'crossoverFreq5',
        label: 'XOver 5',
        min: 20,
        max: 20000,
        default: 12000,
        unit: 'Hz',
        step: 1,
        scaling: 'log',
    },
    { id: 'crossoverSlope', label: 'Slope', min: 0, max: 3, default: 1, unit: '', step: 1 },
    { id: 'crossoverMode', label: 'XOver Mode', min: 0, max: 1, default: 0, unit: '', step: 1 },

    // Per-band distortion (band 0 — UI maps active band)
    { id: 'distortionMode', label: 'Dist Mode', min: 0, max: 8, default: 0, unit: '', step: 1 },
    { id: 'drive', label: 'Drive', min: 0, max: 100, default: 25, unit: '%', step: 1 },
    { id: 'asymmetry', label: 'Asymmetry', min: -1, max: 1, default: 0, unit: '', step: 0.01 },
    { id: 'foldbackThreshold', label: 'Fold Thresh', min: 0.1, max: 1, default: 0.7, unit: '', step: 0.01 },
    { id: 'bitDepth', label: 'Bit Depth', min: 1, max: 24, default: 16, unit: 'bit', step: 1 },
    { id: 'sampleRateReduce', label: 'SR Reduce', min: 1, max: 64, default: 1, unit: 'x', step: 1 },
    { id: 'breakdownDepth', label: 'Breakdown', min: 0, max: 4, default: 1, unit: 'oct', step: 0.1 },

    // Per-band filter
    { id: 'filterMode', label: 'Filter Mode', min: 0, max: 5, default: 0, unit: '', step: 1 },
    { id: 'filterCutoff', label: 'Cutoff', min: 20, max: 20000, default: 8000, unit: 'Hz', step: 1, scaling: 'log' },
    { id: 'filterResonance', label: 'Resonance', min: 0, max: 1, default: 0.3, unit: '', step: 0.01 },
    { id: 'filterEnvAmount', label: 'Env Amount', min: -1, max: 1, default: 0, unit: '', step: 0.01 },

    // Modulation effects
    { id: 'chorusRate', label: 'Chorus Rate', min: 0.01, max: 20, default: 1.5, unit: 'Hz', scaling: 'log' },
    { id: 'chorusDepth', label: 'Chorus Depth', min: 0, max: 1, default: 0.4, unit: '', step: 0.01 },
    { id: 'chorusFeedback', label: 'Chorus FB', min: -1, max: 1, default: 0.2, unit: '', step: 0.01 },
    { id: 'chorusMix', label: 'Chorus Mix', min: 0, max: 1, default: 0.5, unit: '', step: 0.01 },

    // Phaser
    { id: 'phaserRate', label: 'Phaser Rate', min: 0.01, max: 10, default: 0.5, unit: 'Hz', scaling: 'log' },
    { id: 'phaserDepth', label: 'Phaser Depth', min: 0, max: 1, default: 0.7, unit: '', step: 0.01 },
    { id: 'phaserFeedback', label: 'Phaser FB', min: -1, max: 1, default: 0.5, unit: '', step: 0.01 },
    { id: 'phaserMix', label: 'Phaser Mix', min: 0, max: 1, default: 0.5, unit: '', step: 0.01 },

    // Granular
    { id: 'grainSize', label: 'Grain Size', min: 10, max: 500, default: 80, unit: 'ms', step: 1, scaling: 'log' },
    { id: 'grainDensity', label: 'Density', min: 1, max: 100, default: 15, unit: 'g/s', step: 1 },
    { id: 'grainPosOffset', label: 'Position', min: 0, max: 2000, default: 100, unit: 'ms', step: 1 },
    { id: 'grainPitch', label: 'Grain Pitch', min: -24, max: 24, default: 0, unit: 'st', step: 0.1 },
    { id: 'grainMix', label: 'Grain Mix', min: 0, max: 1, default: 0.5, unit: '', step: 0.01 },

    // Spectral
    { id: 'spectralBlur', label: 'Spec Blur', min: 0, max: 1, default: 0.5, unit: '', step: 0.01 },
    { id: 'spectralMix', label: 'Spec Mix', min: 0, max: 1, default: 0.5, unit: '', step: 0.01 },

    // Frequency shifter
    { id: 'freqShiftHz', label: 'Freq Shift', min: -1000, max: 1000, default: 0, unit: 'Hz', step: 0.1 },
    { id: 'freqShiftMix', label: 'Shift Mix', min: 0, max: 1, default: 0.5, unit: '', step: 0.01 },

    // Lo-fi
    { id: 'lofiAmount', label: 'Lo-Fi', min: 0, max: 100, default: 0, unit: '%', step: 1 },
    { id: 'codecArtifact', label: 'Codec', min: 0, max: 1, default: 0, unit: '', step: 0.01 },

    // Convolution
    { id: 'convolutionMix', label: 'Body Mix', min: 0, max: 1, default: 0.3, unit: '', step: 0.01 },
    { id: 'convolutionSeparation', label: 'Separation', min: 0, max: 1, default: 0.5, unit: '', step: 0.01 },

    // Macros
    { id: 'macro1', label: 'Macro 1', min: 0, max: 1, default: 0.5, unit: '', step: 0.01 },
    { id: 'macro2', label: 'Macro 2', min: 0, max: 1, default: 0.5, unit: '', step: 0.01 },
    { id: 'macro3', label: 'Macro 3', min: 0, max: 1, default: 0.5, unit: '', step: 0.01 },
    { id: 'macro4', label: 'Macro 4', min: 0, max: 1, default: 0.5, unit: '', step: 0.01 },
    { id: 'macro5', label: 'Macro 5', min: 0, max: 1, default: 0.5, unit: '', step: 0.01 },
    { id: 'macro6', label: 'Macro 6', min: 0, max: 1, default: 0.5, unit: '', step: 0.01 },
    { id: 'macro7', label: 'Macro 7', min: 0, max: 1, default: 0.5, unit: '', step: 0.01 },
    { id: 'macro8', label: 'Macro 8', min: 0, max: 1, default: 0.5, unit: '', step: 0.01 },

    // XY Morph
    { id: 'morphX', label: 'Morph X', min: 0, max: 1, default: 0.5, unit: '', step: 0.01 },
    { id: 'morphY', label: 'Morph Y', min: 0, max: 1, default: 0.5, unit: '', step: 0.01 },

    // Global modulation
    { id: 'lfo1Rate', label: 'LFO 1 Rate', min: 0.01, max: 40, default: 2, unit: 'Hz', scaling: 'log' },
    { id: 'lfo1Shape', label: 'LFO 1 Shape', min: 0, max: 4, default: 0, unit: '', step: 1 },
    { id: 'lfo1Amount', label: 'LFO 1 Amt', min: 0, max: 1, default: 0.5, unit: '', step: 0.01 },
    { id: 'lfo2Rate', label: 'LFO 2 Rate', min: 0.01, max: 40, default: 0.5, unit: 'Hz', scaling: 'log' },
    { id: 'lfo2Shape', label: 'LFO 2 Shape', min: 0, max: 4, default: 1, unit: '', step: 1 },
    { id: 'lfo2Amount', label: 'LFO 2 Amt', min: 0, max: 1, default: 0.5, unit: '', step: 0.01 },
    { id: 'envFollowerAttack', label: 'Env Atk', min: 0.1, max: 100, default: 5, unit: 'ms', scaling: 'log' },
    { id: 'envFollowerRelease', label: 'Env Rel', min: 1, max: 2000, default: 200, unit: 'ms', scaling: 'log' },

    // Per-band gain (exposed for automation).
    //
    // The id is `gain` because that is what every other layer already calls it:
    // `BacteriaBand.gain`, the BandStrip knob, the bridge's `bandN_gain` engine
    // key, and `BandChain::set_param`'s `"gain"` arm. This entry read `bandGain`
    // — a name nothing else used — so the lane picker offered "Band Gain", a
    // drawn ±24 dB curve reached the engine, fell through `BandChain`'s
    // catch-all to sub-processors that all ignored it, and persisted into the
    // project file having never moved a sample.
    //
    // Bare, like every other per-band entry here (`drive`, `filterCutoff`, …):
    // Bacteria's engine broadcasts an unprefixed name to all bands, while the
    // panel addresses one band through the `bandN_` prefix.
    { id: 'gain', label: 'Band Gain', min: -24, max: 24, default: 0, unit: 'dB', step: 0.5 },
];

export const BACTERIA_DESCRIPTOR: PluginDescriptor = {
    id: 'bacteria',
    name: 'Bacteria',
    vendor: 'Sourdaw',
    format: 'builtin',
    category: 'effect',
    hasCustomUI: true,
    parameters: BACTERIA_PARAMS.map((param) => ({
        id: param.id,
        deviceId: 'bacteria',
        name: param.label,
        type: param.step === 1 ? 'int' : 'float',
        value: param.default,
        defaultValue: param.default,
        minValue: param.min,
        maxValue: param.max,
        unit: param.unit,
        scaling: param.scaling,
        automatable: true,
        hasAutomation: false,
    })),
};
