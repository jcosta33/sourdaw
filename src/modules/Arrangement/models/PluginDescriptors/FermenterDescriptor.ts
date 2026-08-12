/**
 * Fermenter — master synth plugin descriptor.
 * Registers Fermenter as a proper instrument that can be added to MIDI tracks.
 *
 * Parameter data is inlined here rather than imported from the Fermenter
 * module. Models must not cross module boundaries; duplication is intentional.
 */

import { type PluginDescriptor, type PluginParamDef } from '../DeviceParameterTypes';

const FERMENTER_PARAMS: readonly PluginParamDef[] = [
    // Oscillator
    { id: 'oscEngine', label: 'Engine', min: 0, max: 6, default: 0, unit: '', step: 1 },
    { id: 'oscWaveform', label: 'Waveform', min: 0, max: 3, default: 1, unit: '', step: 1 },
    { id: 'oscLevel', label: 'Osc Level', min: 0, max: 1, default: 0.8, unit: '' },
    { id: 'oscCoarse', label: 'Coarse', min: -24, max: 24, default: 0, unit: 'st', step: 1 },
    // ADR 0025: fine tune is continuous while coarse tune remains stepped.
    // `fermenterParamMetadataWeld.spec.ts` keeps this duplicated descriptor
    // aligned with the Fermenter-owned parameter table.
    { id: 'oscFine', label: 'Fine', min: -100, max: 100, default: 0, unit: 'ct' },
    { id: 'pulseWidth', label: 'Pulse Width', min: 0.05, max: 0.95, default: 0.5, unit: '' },

    // Unison
    { id: 'unisonVoices', label: 'Unison', min: 1, max: 16, default: 1, unit: '', step: 1 },
    { id: 'unisonDetune', label: 'Detune', min: 0, max: 100, default: 15, unit: 'ct' },
    { id: 'unisonSpread', label: 'Spread', min: 0, max: 1, default: 0.7, unit: '' },

    // Noise
    { id: 'noiseLevel', label: 'Noise', min: 0, max: 1, default: 0, unit: '' },
    { id: 'noiseColor', label: 'Color', min: 0, max: 2, default: 0, unit: '', step: 1 },

    // Drift
    { id: 'oscDrift', label: 'Drift', min: 0, max: 1, default: 0, unit: '' },

    // Time-Domain Warp
    { id: 'warpMode', label: 'Warp Mode', min: 0, max: 6, default: 0, unit: '', step: 1 },
    { id: 'warpAmount', label: 'Warp Amount', min: 0, max: 1, default: 0, unit: '' },

    // Audio-Rate Modulation
    { id: 'audioModRate', label: 'AM/FM Rate', min: 0, max: 5000, default: 0, unit: 'Hz' },
    { id: 'audioModDepth', label: 'AM/FM Depth', min: 0, max: 1, default: 0, unit: '' },
    { id: 'audioModTarget', label: 'AM/FM Target', min: 0, max: 3, default: 0, unit: '', step: 1 },

    // Additive
    { id: 'additivePartials', label: 'Partials', min: 1, max: 64, default: 32, unit: '', step: 1 },
    { id: 'additiveTilt', label: 'Tilt', min: -6, max: 6, default: 0, unit: 'dB' },
    { id: 'additiveOdd', label: 'Odd Emphasis', min: 0, max: 1, default: 0, unit: '' },
    { id: 'additiveInharm', label: 'Inharmonicity', min: 0, max: 0.1, default: 0, unit: '' },

    // Karplus-Strong
    { id: 'ksDamping', label: 'Damping', min: 0, max: 0.99, default: 0.5, unit: '' },
    { id: 'ksBrightness', label: 'Brightness', min: 0.1, max: 1, default: 0.7, unit: '' },

    // Granular
    { id: 'grainDensity', label: 'Density', min: 1, max: 100, default: 20, unit: 'g/s' },
    { id: 'grainSize', label: 'Size', min: 5, max: 500, default: 50, unit: 'ms' },
    { id: 'grainPosition', label: 'Position', min: 0, max: 1, default: 0, unit: '' },
    { id: 'grainSpray', label: 'Spray', min: 0, max: 1, default: 0.1, unit: '' },
    { id: 'grainPitchVar', label: 'Pitch Var', min: 0, max: 12, default: 0, unit: 'st' },
    { id: 'grainPanSpread', label: 'Pan Spread', min: 0, max: 1, default: 0.5, unit: '' },

    // Sampler
    { id: 'samplerMode', label: 'Play Mode', min: 0, max: 2, default: 0, unit: '', step: 1 },
    { id: 'samplerStart', label: 'Start', min: 0, max: 1, default: 0, unit: '' },
    { id: 'samplerEnd', label: 'End', min: 0, max: 1, default: 1, unit: '' },

    // Per-voice FX
    { id: 'voiceDrive', label: 'Voice Drive', min: 0, max: 10, default: 0, unit: '' },

    // Filter
    { id: 'filterModel', label: 'Filter Model', min: 0, max: 5, default: 0, unit: '', step: 1 },
    { id: 'filterCutoff', label: 'Cutoff', min: 20, max: 20000, default: 5000, unit: 'Hz', scaling: 'log' },
    { id: 'filterResonance', label: 'Resonance', min: 0.5, max: 20, default: 1, unit: '' },
    { id: 'filterMode', label: 'Filter Type', min: 0, max: 3, default: 0, unit: '', step: 1 },
    { id: 'filterDrive', label: 'Drive', min: 0, max: 10, default: 0, unit: '' },
    { id: 'filterKeytrack', label: 'Key Track', min: 0, max: 1, default: 0, unit: '' },
    { id: 'filterEnvAmount', label: 'Env → Filter', min: -1, max: 1, default: 0.5, unit: '' },

    // FM Engine
    { id: 'fmAlgorithm', label: 'FM Algorithm', min: 0, max: 7, default: 0, unit: '', step: 1 },
    { id: 'fmRatio1', label: 'Op1 Ratio', min: 0.5, max: 16, default: 1, unit: '' },
    { id: 'fmRatio2', label: 'Op2 Ratio', min: 0.5, max: 16, default: 2, unit: '' },
    { id: 'fmRatio3', label: 'Op3 Ratio', min: 0.5, max: 16, default: 3, unit: '' },
    { id: 'fmRatio4', label: 'Op4 Ratio', min: 0.5, max: 16, default: 4, unit: '' },
    { id: 'fmLevel1', label: 'Op1 Level', min: 0, max: 1, default: 1, unit: '' },
    { id: 'fmLevel2', label: 'Op2 Level', min: 0, max: 1, default: 0.8, unit: '' },
    { id: 'fmLevel3', label: 'Op3 Level', min: 0, max: 1, default: 0.5, unit: '' },
    { id: 'fmLevel4', label: 'Op4 Level', min: 0, max: 1, default: 0.3, unit: '' },
    { id: 'fmFeedback', label: 'FM Feedback', min: 0, max: 1, default: 0, unit: '' },
    { id: 'fmModAmount', label: 'FM Depth', min: 0, max: 4, default: 1, unit: '' },

    // Amp ADSR
    { id: 'ampAttack', label: 'Attack', min: 0.001, max: 5, default: 0.01, unit: 's', scaling: 'log' },
    { id: 'ampDecay', label: 'Decay', min: 0.001, max: 5, default: 0.2, unit: 's', scaling: 'log' },
    { id: 'ampSustain', label: 'Sustain', min: 0, max: 1, default: 0.7, unit: '' },
    { id: 'ampRelease', label: 'Release', min: 0.001, max: 10, default: 0.3, unit: 's', scaling: 'log' },

    // Filter ADSR
    { id: 'filterAttack', label: 'Filter Attack', min: 0.001, max: 5, default: 0.01, unit: 's', scaling: 'log' },
    { id: 'filterDecay', label: 'Filter Decay', min: 0.001, max: 5, default: 0.3, unit: 's', scaling: 'log' },
    { id: 'filterSustain', label: 'Filter Sustain', min: 0, max: 1, default: 0, unit: '' },
    { id: 'filterRelease', label: 'Filter Release', min: 0.001, max: 10, default: 0.3, unit: 's', scaling: 'log' },

    // LFO
    { id: 'lfoRate', label: 'LFO Rate', min: 0, max: 5000, default: 0, unit: 'Hz' },
    { id: 'lfoShape', label: 'LFO Shape', min: 0, max: 3, default: 0, unit: '', step: 1 },
    { id: 'lfoPitchAmount', label: 'LFO → Pitch', min: -1, max: 1, default: 0, unit: '' },
    { id: 'lfoFilterAmount', label: 'LFO → Filter', min: -1, max: 1, default: 0, unit: '' },

    // MSEG
    { id: 'msegToFilter', label: 'MSEG → Filter', min: -1, max: 1, default: 0, unit: '' },

    // Step Sequencer
    { id: 'seqRate', label: 'Seq Rate', min: 0.5, max: 20, default: 4, unit: 'Hz', scaling: 'log' },
    { id: 'seqToPitch', label: 'Seq → Pitch', min: -1, max: 1, default: 0, unit: '' },

    // Portamento
    { id: 'portamentoTime', label: 'Glide', min: 0, max: 2, default: 0, unit: 's' },
    { id: 'portamentoMode', label: 'Glide Mode', min: 0, max: 1, default: 0, unit: '', step: 1 },

    // Reverb
    { id: 'reverbType', label: 'Reverb Type', min: 0, max: 1, default: 0, unit: '', step: 1 },
    { id: 'reverbMix', label: 'Reverb', min: 0, max: 1, default: 0.2, unit: '' },
    { id: 'reverbDecay', label: 'Reverb Decay', min: 0, max: 0.99, default: 0.5, unit: '' },

    // EQ
    { id: 'eqLowFreq', label: 'Low Freq', min: 20, max: 500, default: 100, unit: 'Hz', scaling: 'log' },
    { id: 'eqLowGain', label: 'Low Gain', min: -24, max: 24, default: 0, unit: 'dB' },
    { id: 'eqLowQ', label: 'Low Q', min: 0.1, max: 10, default: 1, unit: '' },
    { id: 'eqMidFreq', label: 'Mid Freq', min: 200, max: 8000, default: 1000, unit: 'Hz', scaling: 'log' },
    { id: 'eqMidGain', label: 'Mid Gain', min: -24, max: 24, default: 0, unit: 'dB' },
    { id: 'eqMidQ', label: 'Mid Q', min: 0.1, max: 10, default: 1, unit: '' },
    { id: 'eqHighFreq', label: 'High Freq', min: 2000, max: 20000, default: 8000, unit: 'Hz', scaling: 'log' },
    { id: 'eqHighGain', label: 'High Gain', min: -24, max: 24, default: 0, unit: 'dB' },
    { id: 'eqHighQ', label: 'High Q', min: 0.1, max: 10, default: 1, unit: '' },

    // Delay
    { id: 'delayTime', label: 'Delay Time', min: 10, max: 2000, default: 375, unit: 'ms', scaling: 'log' },
    { id: 'delayFeedback', label: 'Delay Feedback', min: 0, max: 0.95, default: 0.35, unit: '' },
    { id: 'delayMix', label: 'Delay Mix', min: 0, max: 1, default: 0, unit: '' },

    // Chorus
    { id: 'chorusRate', label: 'Chorus Rate', min: 0.1, max: 5, default: 1.2, unit: 'Hz' },
    { id: 'chorusDepth', label: 'Chorus Depth', min: 0, max: 1, default: 0.4, unit: '' },
    { id: 'chorusMix', label: 'Chorus Mix', min: 0, max: 1, default: 0, unit: '' },

    // Phaser
    { id: 'phaserRate', label: 'Phaser Rate', min: 0.1, max: 5, default: 0.5, unit: 'Hz' },
    { id: 'phaserDepth', label: 'Phaser Depth', min: 0, max: 1, default: 0.5, unit: '' },
    { id: 'phaserMix', label: 'Phaser Mix', min: 0, max: 1, default: 0, unit: '' },

    // Distortion
    { id: 'distDrive', label: 'Dist Drive', min: 0, max: 10, default: 0, unit: '' },
    { id: 'distTone', label: 'Dist Tone', min: 0, max: 1, default: 0.5, unit: '' },
    { id: 'distMix', label: 'Dist Mix', min: 0, max: 1, default: 0, unit: '' },

    // Compressor
    { id: 'compThreshold', label: 'Comp Threshold', min: -60, max: 0, default: -20, unit: 'dB' },
    { id: 'compRatio', label: 'Comp Ratio', min: 1, max: 20, default: 4, unit: ':1' },
    { id: 'compAttack', label: 'Comp Attack', min: 0.1, max: 100, default: 10, unit: 'ms', scaling: 'log' },
    { id: 'compRelease', label: 'Comp Release', min: 10, max: 1000, default: 100, unit: 'ms', scaling: 'log' },
    { id: 'compMix', label: 'Comp Mix', min: 0, max: 1, default: 0, unit: '' },

    // Stereo Width
    { id: 'stereoWidth', label: 'Width', min: 0, max: 2, default: 1, unit: '' },

    // Layer
    { id: 'activeLayer', label: 'Active Layer', min: 0, max: 3, default: 0, unit: '', step: 1 },
    { id: 'numLayers', label: 'Layers', min: 1, max: 4, default: 1, unit: '', step: 1 },
    { id: 'layerLevel', label: 'Layer Level', min: 0, max: 1, default: 1, unit: '' },
    { id: 'layerPan', label: 'Layer Pan', min: -1, max: 1, default: 0, unit: '' },

    // Chaos
    { id: 'chaosAmount', label: 'Chaos', min: 0, max: 1, default: 0, unit: '' },
    { id: 'chaosSpeed', label: 'Chaos Speed', min: 0.01, max: 10, default: 1, unit: '' },

    // Master
    { id: 'masterGain', label: 'Master', min: 0, max: 2, default: 1, unit: '' },
];

export const FERMENTER_DESCRIPTOR: PluginDescriptor = {
    id: 'fermenter',
    name: 'Fermenter',
    vendor: 'Sourdaw',
    format: 'builtin',
    category: 'instrument',
    hasCustomUI: true,
    tail: { kind: 'decaySeconds', parameterId: 'ampRelease', defaultSeconds: 0.3 },
    parameters: FERMENTER_PARAMS.map((param) => ({
        id: param.id,
        deviceId: 'fermenter',
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
