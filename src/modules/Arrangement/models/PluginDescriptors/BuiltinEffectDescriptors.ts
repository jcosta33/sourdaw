import { type PluginDescriptor } from '../DeviceParameterTypes';

import { applyDescriptorGuidance, descriptorGuidance, parameterGuidance } from './DescriptorGuidance';
import { NO_SOURCE_SPECIFIC_MODULATION, analysisGuidance, effectGuidance } from './GuidanceProfiles';

/** Built-in effect plugin descriptors (EQ, Compressor, Reverb, Delay, etc.) */
const BUILTIN_EFFECT_DESCRIPTOR_DATA: PluginDescriptor[] = [
    {
        id: 'builtin-eq',
        name: 'EQ',
        vendor: 'Sourdaw',
        format: 'builtin',
        category: 'effect',
        hasCustomUI: false,
        platform: 'both',
        parameters: [
            {
                id: 'eq-low-gain',
                deviceId: 'builtin-eq',
                name: 'Low Gain',
                type: 'float',
                value: 0,
                defaultValue: 0,
                minValue: -24,
                maxValue: 24,
                unit: 'dB',
                automatable: true,
                hasAutomation: false,
            },
            {
                id: 'eq-low-freq',
                deviceId: 'builtin-eq',
                name: 'Low Freq',
                type: 'float',
                value: 100,
                defaultValue: 100,
                minValue: 20,
                maxValue: 500,
                unit: 'Hz',
                automatable: true,
                hasAutomation: false,
            },
            {
                id: 'eq-low-q',
                deviceId: 'builtin-eq',
                name: 'Low Q',
                type: 'float',
                value: 1,
                defaultValue: 1,
                minValue: 0.1,
                maxValue: 10,
                unit: '',
                automatable: true,
                hasAutomation: false,
            },
            {
                id: 'eq-mid-gain',
                deviceId: 'builtin-eq',
                name: 'Mid Gain',
                type: 'float',
                value: 0,
                defaultValue: 0,
                minValue: -24,
                maxValue: 24,
                unit: 'dB',
                automatable: true,
                hasAutomation: false,
            },
            {
                id: 'eq-mid-freq',
                deviceId: 'builtin-eq',
                name: 'Mid Freq',
                type: 'float',
                value: 1000,
                defaultValue: 1000,
                minValue: 200,
                maxValue: 8000,
                unit: 'Hz',
                automatable: true,
                hasAutomation: false,
            },
            {
                id: 'eq-mid-q',
                deviceId: 'builtin-eq',
                name: 'Mid Q',
                type: 'float',
                value: 1,
                defaultValue: 1,
                minValue: 0.1,
                maxValue: 10,
                unit: '',
                automatable: true,
                hasAutomation: false,
            },
            {
                id: 'eq-high-gain',
                deviceId: 'builtin-eq',
                name: 'High Gain',
                type: 'float',
                value: 0,
                defaultValue: 0,
                minValue: -24,
                maxValue: 24,
                unit: 'dB',
                automatable: true,
                hasAutomation: false,
            },
            {
                id: 'eq-high-freq',
                deviceId: 'builtin-eq',
                name: 'High Freq',
                type: 'float',
                value: 8000,
                defaultValue: 8000,
                minValue: 2000,
                maxValue: 20000,
                unit: 'Hz',
                automatable: true,
                hasAutomation: false,
            },
            {
                id: 'eq-high-q',
                deviceId: 'builtin-eq',
                name: 'High Q',
                type: 'float',
                value: 1,
                defaultValue: 1,
                minValue: 0.1,
                maxValue: 10,
                unit: '',
                automatable: true,
                hasAutomation: false,
            },
        ],
    },
    {
        id: 'builtin-compressor',
        name: 'Compressor',
        vendor: 'Sourdaw',
        format: 'builtin',
        category: 'effect',
        hasCustomUI: false,
        platform: 'both',
        parameters: [
            {
                id: 'comp-threshold',
                deviceId: 'builtin-compressor',
                name: 'Threshold',
                type: 'float',
                value: -20,
                defaultValue: -20,
                minValue: -60,
                maxValue: 0,
                unit: 'dB',
                automatable: true,
                hasAutomation: false,
            },
            {
                id: 'comp-ratio',
                deviceId: 'builtin-compressor',
                name: 'Ratio',
                type: 'float',
                value: 4,
                defaultValue: 4,
                minValue: 1,
                maxValue: 20,
                unit: ':1',
                automatable: true,
                hasAutomation: false,
            },
            {
                id: 'comp-attack',
                deviceId: 'builtin-compressor',
                name: 'Attack',
                type: 'float',
                value: 10,
                defaultValue: 10,
                minValue: 0.1,
                maxValue: 100,
                unit: 'ms',
                automatable: true,
                hasAutomation: false,
            },
            {
                id: 'comp-release',
                deviceId: 'builtin-compressor',
                name: 'Release',
                type: 'float',
                value: 100,
                defaultValue: 100,
                minValue: 10,
                maxValue: 1000,
                unit: 'ms',
                automatable: true,
                hasAutomation: false,
            },
            {
                id: 'comp-knee',
                deviceId: 'builtin-compressor',
                name: 'Knee',
                type: 'float',
                value: 6,
                defaultValue: 6,
                minValue: 0,
                maxValue: 30,
                unit: 'dB',
                automatable: true,
                hasAutomation: false,
            },
            {
                id: 'comp-makeup',
                deviceId: 'builtin-compressor',
                name: 'Makeup',
                type: 'float',
                value: 0,
                defaultValue: 0,
                minValue: 0,
                maxValue: 30,
                unit: 'dB',
                automatable: true,
                hasAutomation: false,
            },
        ],
    },
    {
        id: 'builtin-reverb',
        name: 'Reverb',
        vendor: 'Sourdaw',
        format: 'builtin',
        category: 'effect',
        hasCustomUI: false,
        platform: 'both',
        // The audible tail is the impulse response, which `applyReverbParams`
        // re-renders from the live Size/Decay/Damping shape (#3731); the decay
        // envelope reaches its -60 dB point at the end of the rendered buffer,
        // so exports must reserve exactly that decay span. The declaration
        // therefore tracks `rev-decay` (default 2 s, matching the historical
        // fixed tail) and must change in the same commit as any impulse-render
        // change. Pre-delay is genuinely honoured, so it still counts.
        tail: {
            kind: 'decaySeconds',
            parameterId: 'rev-decay',
            defaultSeconds: 2,
            predelayMsParameterId: 'rev-predelay',
        },
        parameters: [
            {
                id: 'rev-size',
                deviceId: 'builtin-reverb',
                name: 'Size',
                type: 'float',
                value: 0.5,
                defaultValue: 0.5,
                minValue: 0,
                maxValue: 1,
                unit: '',
                automatable: true,
                hasAutomation: false,
            },
            {
                id: 'rev-decay',
                deviceId: 'builtin-reverb',
                name: 'Decay',
                type: 'float',
                value: 2,
                defaultValue: 2,
                minValue: 0.1,
                maxValue: 20,
                unit: 's',
                automatable: true,
                hasAutomation: false,
            },
            {
                id: 'rev-damping',
                deviceId: 'builtin-reverb',
                name: 'Damping',
                type: 'float',
                value: 0.5,
                defaultValue: 0.5,
                minValue: 0,
                maxValue: 1,
                unit: '',
                automatable: true,
                hasAutomation: false,
            },
            {
                id: 'rev-predelay',
                deviceId: 'builtin-reverb',
                name: 'Pre-Delay',
                type: 'float',
                value: 10,
                defaultValue: 10,
                minValue: 0,
                maxValue: 200,
                unit: 'ms',
                automatable: true,
                hasAutomation: false,
            },
            {
                id: 'rev-lowcut',
                deviceId: 'builtin-reverb',
                name: 'Low Cut',
                type: 'float',
                value: 80,
                defaultValue: 80,
                minValue: 20,
                maxValue: 2000,
                unit: 'Hz',
                automatable: true,
                hasAutomation: false,
            },
            {
                id: 'rev-mix',
                deviceId: 'builtin-reverb',
                name: 'Dry/Wet',
                type: 'float',
                value: 0.3,
                defaultValue: 0.3,
                minValue: 0,
                maxValue: 1,
                unit: '',
                automatable: true,
                hasAutomation: false,
            },
        ],
    },
    {
        id: 'builtin-delay',
        name: 'Delay',
        vendor: 'Sourdaw',
        format: 'builtin',
        category: 'effect',
        hasCustomUI: false,
        platform: 'both',
        tail: {
            kind: 'feedbackLoop',
            feedbackParameterId: 'delay-feedback',
            defaultFeedback: 0.4,
            maxFeedback: 0.95,
            loopParameterId: 'delay-time',
            loopUnit: 'ms',
            defaultLoopSeconds: 0.25,
        },
        parameters: [
            {
                id: 'delay-time',
                deviceId: 'builtin-delay',
                name: 'Time',
                type: 'float',
                value: 250,
                defaultValue: 250,
                minValue: 1,
                maxValue: 2000,
                unit: 'ms',
                automatable: true,
                hasAutomation: false,
            },
            {
                id: 'delay-feedback',
                deviceId: 'builtin-delay',
                name: 'Feedback',
                type: 'float',
                value: 0.4,
                defaultValue: 0.4,
                minValue: 0,
                maxValue: 0.95,
                unit: '',
                automatable: true,
                hasAutomation: false,
            },
            {
                id: 'delay-lowcut',
                deviceId: 'builtin-delay',
                name: 'Low Cut',
                type: 'float',
                value: 80,
                defaultValue: 80,
                minValue: 20,
                maxValue: 2000,
                unit: 'Hz',
                automatable: true,
                hasAutomation: false,
            },
            {
                id: 'delay-highcut',
                deviceId: 'builtin-delay',
                name: 'High Cut',
                type: 'float',
                value: 12000,
                defaultValue: 12000,
                minValue: 1000,
                maxValue: 20000,
                unit: 'Hz',
                automatable: true,
                hasAutomation: false,
            },
            {
                id: 'delay-mix',
                deviceId: 'builtin-delay',
                name: 'Dry/Wet',
                type: 'float',
                value: 0.3,
                defaultValue: 0.3,
                minValue: 0,
                maxValue: 1,
                unit: '',
                automatable: true,
                hasAutomation: false,
            },
        ],
    },
    {
        id: 'builtin-gain',
        name: 'Gain',
        vendor: 'Sourdaw',
        format: 'builtin',
        category: 'utility',
        hasCustomUI: false,
        platform: 'both',
        parameters: [
            {
                id: 'gain-level',
                deviceId: 'builtin-gain',
                name: 'Gain',
                type: 'float',
                value: 0,
                defaultValue: 0,
                minValue: -60,
                maxValue: 24,
                unit: 'dB',
                automatable: true,
                hasAutomation: false,
            },
        ],
    },
    {
        id: 'builtin-sidechain-compressor',
        name: 'Sidechain Compressor',
        vendor: 'Sourdaw',
        format: 'builtin',
        category: 'effect',
        hasCustomUI: false,
        parameters: [
            {
                id: 'sc-comp-threshold',
                deviceId: 'builtin-sidechain-compressor',
                name: 'Threshold',
                type: 'float',
                value: -20,
                defaultValue: -20,
                minValue: -60,
                maxValue: 0,
                unit: 'dB',
                automatable: true,
                hasAutomation: false,
            },
            {
                id: 'sc-comp-ratio',
                deviceId: 'builtin-sidechain-compressor',
                name: 'Ratio',
                type: 'float',
                value: 4,
                defaultValue: 4,
                minValue: 1,
                maxValue: 20,
                unit: ':1',
                automatable: true,
                hasAutomation: false,
            },
            {
                id: 'sc-comp-attack',
                deviceId: 'builtin-sidechain-compressor',
                name: 'Attack',
                type: 'float',
                value: 10,
                defaultValue: 10,
                minValue: 1,
                maxValue: 100,
                unit: 'ms',
                automatable: true,
                hasAutomation: false,
            },
            {
                id: 'sc-comp-release',
                deviceId: 'builtin-sidechain-compressor',
                name: 'Release',
                type: 'float',
                value: 100,
                defaultValue: 100,
                minValue: 10,
                maxValue: 1000,
                unit: 'ms',
                automatable: true,
                hasAutomation: false,
            },
            {
                id: 'sc-comp-makeup',
                deviceId: 'builtin-sidechain-compressor',
                name: 'Makeup',
                type: 'float',
                value: 0,
                defaultValue: 0,
                minValue: 0,
                maxValue: 30,
                unit: 'dB',
                automatable: true,
                hasAutomation: false,
            },
        ],
    },
    {
        id: 'builtin-chorus',
        name: 'Chorus',
        vendor: 'Sourdaw',
        format: 'builtin',
        category: 'effect',
        hasCustomUI: false,
        parameters: [
            {
                id: 'chorus-rate',
                deviceId: 'builtin-chorus',
                name: 'Rate',
                type: 'float',
                value: 1.5,
                defaultValue: 1.5,
                minValue: 0.1,
                maxValue: 10,
                unit: 'Hz',
                automatable: true,
                hasAutomation: false,
            },
            {
                id: 'chorus-depth',
                deviceId: 'builtin-chorus',
                name: 'Depth',
                type: 'float',
                value: 5,
                defaultValue: 5,
                minValue: 0,
                maxValue: 20,
                unit: 'ms',
                automatable: true,
                hasAutomation: false,
            },
            {
                id: 'chorus-feedback',
                deviceId: 'builtin-chorus',
                name: 'Feedback',
                type: 'float',
                value: 0.2,
                defaultValue: 0.2,
                minValue: 0,
                maxValue: 0.9,
                unit: '',
                automatable: true,
                hasAutomation: false,
            },
            {
                id: 'chorus-mix',
                deviceId: 'builtin-chorus',
                name: 'Dry/Wet',
                type: 'float',
                value: 0.5,
                defaultValue: 0.5,
                minValue: 0,
                maxValue: 1,
                unit: '',
                automatable: true,
                hasAutomation: false,
            },
        ],
    },
    {
        id: 'builtin-phaser',
        name: 'Phaser',
        vendor: 'Sourdaw',
        format: 'builtin',
        category: 'effect',
        hasCustomUI: false,
        parameters: [
            {
                id: 'phaser-rate',
                deviceId: 'builtin-phaser',
                name: 'Rate',
                type: 'float',
                value: 0.5,
                defaultValue: 0.5,
                // `applyPhaserParams` assigns this to the sweep
                // `OscillatorNode.frequency`, which accepts any rate down to a
                // stopped LFO at 0 Hz. The old 0.1 was the knob's floor, and it
                // sat above values this repo already ships (Nebula Drift's
                // 0.05/0.06 and an 0.08 automation point,
                // `synth-pad-dark-drone`'s 0.05).
                minValue: 0,
                maxValue: 10,
                unit: 'Hz',
                automatable: true,
                hasAutomation: false,
            },
            {
                id: 'phaser-depth',
                deviceId: 'builtin-phaser',
                name: 'Depth',
                type: 'float',
                value: 0.7,
                defaultValue: 0.7,
                minValue: 0,
                maxValue: 1,
                unit: '',
                automatable: true,
                hasAutomation: false,
            },
            {
                id: 'phaser-feedback',
                deviceId: 'builtin-phaser',
                name: 'Feedback',
                type: 'float',
                value: 0.3,
                defaultValue: 0.3,
                minValue: 0,
                maxValue: 0.9,
                unit: '',
                automatable: true,
                hasAutomation: false,
            },
            {
                id: 'phaser-stages',
                deviceId: 'builtin-phaser',
                name: 'Stages',
                type: 'int',
                value: 4,
                defaultValue: 4,
                minValue: 2,
                maxValue: 12,
                unit: '',
                automatable: false,
                hasAutomation: false,
            },
        ],
    },
    {
        id: 'builtin-distortion',
        name: 'Distortion',
        vendor: 'Sourdaw',
        format: 'builtin',
        category: 'effect',
        hasCustomUI: false,
        parameters: [
            {
                id: 'dist-drive',
                deviceId: 'builtin-distortion',
                name: 'Drive',
                type: 'float',
                value: 20,
                defaultValue: 20,
                minValue: 0,
                maxValue: 100,
                unit: '',
                automatable: true,
                hasAutomation: false,
            },
            {
                id: 'dist-tone',
                deviceId: 'builtin-distortion',
                name: 'Tone',
                type: 'float',
                value: 4000,
                defaultValue: 4000,
                minValue: 200,
                maxValue: 8000,
                unit: 'Hz',
                automatable: true,
                hasAutomation: false,
            },
            {
                id: 'dist-output',
                deviceId: 'builtin-distortion',
                name: 'Output Level',
                type: 'float',
                value: 0,
                defaultValue: 0,
                minValue: -24,
                maxValue: 0,
                unit: 'dB',
                automatable: true,
                hasAutomation: false,
            },
            {
                id: 'dist-mix',
                deviceId: 'builtin-distortion',
                name: 'Dry/Wet',
                type: 'float',
                value: 0.5,
                defaultValue: 0.5,
                minValue: 0,
                maxValue: 1,
                unit: '',
                automatable: true,
                hasAutomation: false,
            },
        ],
    },
    {
        id: 'builtin-limiter',
        name: 'Limiter',
        vendor: 'Sourdaw',
        format: 'builtin',
        category: 'effect',
        hasCustomUI: false,
        platform: 'both',
        parameters: [
            {
                id: 'lim-threshold',
                deviceId: 'builtin-limiter',
                name: 'Threshold',
                type: 'float',
                value: -6,
                defaultValue: -6,
                minValue: -30,
                maxValue: 0,
                unit: 'dB',
                automatable: true,
                hasAutomation: false,
            },
            {
                id: 'lim-release',
                deviceId: 'builtin-limiter',
                name: 'Release',
                type: 'float',
                value: 100,
                defaultValue: 100,
                minValue: 10,
                maxValue: 500,
                unit: 'ms',
                automatable: true,
                hasAutomation: false,
            },
            {
                id: 'lim-ceiling',
                deviceId: 'builtin-limiter',
                name: 'Ceiling',
                type: 'float',
                value: -0.3,
                defaultValue: -0.3,
                minValue: -3,
                maxValue: 0,
                unit: 'dB',
                automatable: true,
                hasAutomation: false,
            },
        ],
    },
    {
        id: 'builtin-flanger',
        name: 'Flanger',
        vendor: 'Sourdaw',
        format: 'builtin',
        category: 'effect',
        hasCustomUI: false,
        parameters: [
            {
                id: 'flanger-rate',
                deviceId: 'builtin-flanger',
                name: 'Rate',
                type: 'float',
                value: 0.3,
                defaultValue: 0.3,
                minValue: 0.05,
                maxValue: 5,
                unit: 'Hz',
                automatable: true,
                hasAutomation: false,
            },
            {
                id: 'flanger-depth',
                deviceId: 'builtin-flanger',
                name: 'Depth',
                type: 'float',
                value: 3,
                defaultValue: 3,
                minValue: 0,
                maxValue: 10,
                unit: 'ms',
                automatable: true,
                hasAutomation: false,
            },
            {
                id: 'flanger-feedback',
                deviceId: 'builtin-flanger',
                name: 'Feedback',
                type: 'float',
                value: 0.5,
                defaultValue: 0.5,
                minValue: 0,
                maxValue: 0.95,
                unit: '',
                automatable: true,
                hasAutomation: false,
            },
            {
                id: 'flanger-mix',
                deviceId: 'builtin-flanger',
                name: 'Dry/Wet',
                type: 'float',
                value: 0.5,
                defaultValue: 0.5,
                minValue: 0,
                maxValue: 1,
                unit: '',
                automatable: true,
                hasAutomation: false,
            },
        ],
    },
    {
        id: 'builtin-tremolo',
        name: 'Tremolo',
        vendor: 'Sourdaw',
        format: 'builtin',
        category: 'effect',
        hasCustomUI: false,
        parameters: [
            {
                id: 'trem-rate',
                deviceId: 'builtin-tremolo',
                name: 'Rate',
                type: 'float',
                value: 4,
                defaultValue: 4,
                minValue: 0.1,
                maxValue: 20,
                unit: 'Hz',
                automatable: true,
                hasAutomation: false,
            },
            {
                id: 'trem-depth',
                deviceId: 'builtin-tremolo',
                name: 'Depth',
                type: 'float',
                value: 0.5,
                defaultValue: 0.5,
                minValue: 0,
                maxValue: 1,
                unit: '',
                automatable: true,
                hasAutomation: false,
            },
            {
                id: 'trem-shape',
                deviceId: 'builtin-tremolo',
                name: 'Shape',
                type: 'choice',
                value: 0,
                defaultValue: 0,
                minValue: 0,
                maxValue: 1,
                unit: '',
                choices: ['Sine', 'Square'],
                automatable: false,
                hasAutomation: false,
            },
        ],
    },
    {
        id: 'builtin-bitcrusher',
        name: 'Bitcrusher',
        vendor: 'Sourdaw',
        format: 'builtin',
        category: 'effect',
        hasCustomUI: false,
        parameters: [
            {
                id: 'crush-bits',
                deviceId: 'builtin-bitcrusher',
                name: 'Bit Depth',
                type: 'int',
                value: 8,
                defaultValue: 8,
                minValue: 1,
                maxValue: 16,
                unit: 'bit',
                automatable: true,
                hasAutomation: false,
            },
            {
                id: 'crush-rate',
                deviceId: 'builtin-bitcrusher',
                name: 'Rate Reduction',
                type: 'float',
                value: 1,
                defaultValue: 1,
                minValue: 1,
                maxValue: 40,
                unit: 'x',
                automatable: true,
                hasAutomation: false,
            },
            {
                id: 'crush-mix',
                deviceId: 'builtin-bitcrusher',
                name: 'Dry/Wet',
                type: 'float',
                value: 0.5,
                defaultValue: 0.5,
                minValue: 0,
                maxValue: 1,
                unit: '',
                automatable: true,
                hasAutomation: false,
            },
        ],
    },
    {
        id: 'builtin-filter',
        name: 'Filter',
        vendor: 'Sourdaw',
        format: 'builtin',
        category: 'effect',
        hasCustomUI: false,
        parameters: [
            {
                id: 'filter-cutoff',
                deviceId: 'builtin-filter',
                name: 'Cutoff',
                type: 'float',
                value: 1000,
                defaultValue: 1000,
                minValue: 20,
                maxValue: 20000,
                unit: 'Hz',
                automatable: true,
                hasAutomation: false,
            },
            {
                id: 'filter-resonance',
                deviceId: 'builtin-filter',
                name: 'Resonance',
                type: 'float',
                value: 1,
                defaultValue: 1,
                minValue: 0.1,
                maxValue: 20,
                unit: '',
                automatable: true,
                hasAutomation: false,
            },
            {
                id: 'filter-type',
                deviceId: 'builtin-filter',
                name: 'Type',
                type: 'choice',
                value: 0,
                defaultValue: 0,
                minValue: 0,
                maxValue: 3,
                unit: '',
                choices: ['Lowpass', 'Highpass', 'Bandpass', 'Notch'],
                automatable: false,
                hasAutomation: false,
            },
        ],
    },
    {
        id: 'builtin-autopan',
        name: 'Auto-Pan',
        vendor: 'Sourdaw',
        format: 'builtin',
        category: 'effect',
        hasCustomUI: false,
        parameters: [
            {
                id: 'autopan-rate',
                deviceId: 'builtin-autopan',
                name: 'Rate',
                type: 'float',
                value: 2,
                defaultValue: 2,
                // Same story as `phaser-rate`: `applyAutoPanParams` writes it
                // to an `OscillatorNode.frequency`, and Nebula Drift ships a
                // 0.06 pan rate with a lane riding it to 0.07.
                minValue: 0,
                maxValue: 10,
                unit: 'Hz',
                automatable: true,
                hasAutomation: false,
            },
            {
                id: 'autopan-depth',
                deviceId: 'builtin-autopan',
                name: 'Depth',
                type: 'float',
                value: 0.7,
                defaultValue: 0.7,
                minValue: 0,
                maxValue: 1,
                unit: '',
                automatable: true,
                hasAutomation: false,
            },
            {
                id: 'autopan-shape',
                deviceId: 'builtin-autopan',
                name: 'Shape',
                type: 'choice',
                value: 0,
                defaultValue: 0,
                minValue: 0,
                maxValue: 1,
                unit: '',
                choices: ['Sine', 'Triangle'],
                automatable: false,
                hasAutomation: false,
            },
        ],
    },
    {
        id: 'builtin-convolution-reverb',
        name: 'Convolution Reverb',
        vendor: 'Sourdaw',
        format: 'builtin',
        category: 'effect',
        hasCustomUI: false,
        // The impulse response sets the tail and no exposed parameter reports its
        // length, so reserve a constant that covers the bundled IRs.
        tail: { kind: 'fixed', seconds: 6 },
        parameters: [
            {
                id: 'conv-ir',
                deviceId: 'builtin-convolution-reverb',
                name: 'IR Type',
                type: 'choice',
                value: 6,
                defaultValue: 6,
                minValue: 0,
                maxValue: 9,
                unit: '',
                choices: [
                    'Small Room',
                    'Large Hall',
                    'Cathedral',
                    'Plate',
                    'Spring',
                    'Chamber',
                    'Studio A',
                    'Studio B',
                    'Warehouse',
                    'Tunnel',
                ],
                automatable: false,
                hasAutomation: false,
            },
            {
                id: 'conv-mix',
                deviceId: 'builtin-convolution-reverb',
                name: 'Mix',
                type: 'float',
                value: 0.4,
                defaultValue: 0.4,
                minValue: 0,
                maxValue: 1,
                unit: '',
                automatable: true,
                hasAutomation: false,
            },
            {
                id: 'conv-predelay',
                deviceId: 'builtin-convolution-reverb',
                name: 'Predelay',
                type: 'float',
                value: 10,
                defaultValue: 10,
                minValue: 0,
                maxValue: 200,
                unit: 'ms',
                automatable: true,
                hasAutomation: false,
            },
            {
                id: 'conv-lowcut',
                deviceId: 'builtin-convolution-reverb',
                name: 'Low Cut',
                type: 'float',
                value: 60,
                defaultValue: 60,
                minValue: 20,
                maxValue: 500,
                unit: 'Hz',
                automatable: true,
                hasAutomation: false,
            },
            {
                id: 'conv-highcut',
                deviceId: 'builtin-convolution-reverb',
                name: 'High Cut',
                type: 'float',
                value: 12000,
                defaultValue: 12000,
                minValue: 1000,
                maxValue: 20000,
                unit: 'Hz',
                automatable: true,
                hasAutomation: false,
            },
        ],
    },
    {
        id: 'builtin-stereo-widener',
        name: 'Stereo Widener',
        vendor: 'Sourdaw',
        format: 'builtin',
        category: 'utility',
        hasCustomUI: false,
        platform: 'both',
        parameters: [
            {
                id: 'width-amount',
                deviceId: 'builtin-stereo-widener',
                name: 'Width',
                type: 'float',
                value: 1,
                defaultValue: 1,
                minValue: 0,
                maxValue: 3,
                unit: '',
                automatable: true,
                hasAutomation: false,
            },
            {
                id: 'width-mid',
                deviceId: 'builtin-stereo-widener',
                name: 'Mid Level',
                type: 'float',
                value: 0,
                defaultValue: 0,
                minValue: -12,
                maxValue: 6,
                unit: 'dB',
                automatable: true,
                hasAutomation: false,
            },
            {
                id: 'width-side',
                deviceId: 'builtin-stereo-widener',
                name: 'Side Level',
                type: 'float',
                value: 0,
                defaultValue: 0,
                minValue: -12,
                maxValue: 6,
                unit: 'dB',
                automatable: true,
                hasAutomation: false,
            },
            {
                id: 'width-mono-bass',
                deviceId: 'builtin-stereo-widener',
                name: 'Mono Bass',
                type: 'float',
                value: 200,
                defaultValue: 200,
                minValue: 20,
                maxValue: 500,
                unit: 'Hz',
                automatable: true,
                hasAutomation: false,
            },
        ],
    },
    {
        id: 'builtin-deesser',
        name: 'De-esser',
        vendor: 'Sourdaw',
        format: 'builtin',
        category: 'effect',
        hasCustomUI: false,
        platform: 'both',
        parameters: [
            {
                id: 'deess-threshold',
                deviceId: 'builtin-deesser',
                name: 'Threshold',
                type: 'float',
                value: -20,
                defaultValue: -20,
                minValue: -40,
                maxValue: 0,
                unit: 'dB',
                automatable: true,
                hasAutomation: false,
            },
            {
                id: 'deess-freq',
                deviceId: 'builtin-deesser',
                name: 'Frequency',
                type: 'float',
                value: 6000,
                defaultValue: 6000,
                minValue: 2000,
                maxValue: 12000,
                unit: 'Hz',
                automatable: true,
                hasAutomation: false,
            },
            {
                id: 'deess-range',
                deviceId: 'builtin-deesser',
                name: 'Range',
                type: 'float',
                value: -12,
                defaultValue: -12,
                minValue: -30,
                maxValue: 0,
                unit: 'dB',
                automatable: true,
                hasAutomation: false,
            },
            {
                id: 'deess-listen',
                deviceId: 'builtin-deesser',
                name: 'Listen',
                type: 'bool',
                value: 0,
                defaultValue: 0,
                minValue: 0,
                maxValue: 1,
                unit: '',
                automatable: false,
                hasAutomation: false,
            },
        ],
    },
    {
        id: 'builtin-lufs-meter',
        name: 'LUFS Meter',
        vendor: 'Sourdaw',
        format: 'builtin',
        category: 'analyzer',
        hasCustomUI: false,
        platform: 'both',
        parameters: [
            {
                id: 'lufs-target',
                deviceId: 'builtin-lufs-meter',
                name: 'Target LUFS',
                type: 'float',
                value: -14,
                defaultValue: -14,
                minValue: -30,
                maxValue: -6,
                unit: 'LUFS',
                automatable: false,
                hasAutomation: false,
            },
            {
                id: 'lufs-window',
                deviceId: 'builtin-lufs-meter',
                name: 'Window',
                type: 'choice',
                value: 0,
                defaultValue: 0,
                minValue: 0,
                maxValue: 2,
                unit: '',
                choices: ['Momentary', 'Short-term', 'Integrated'],
                automatable: false,
                hasAutomation: false,
            },
        ],
    },
];

const noExternalModulation = NO_SOURCE_SPECIFIC_MODULATION;

const BUILTIN_EFFECT_DESCRIPTORS_GUIDANCE = [
    descriptorGuidance(
        'builtin-eq',
        effectGuidance(
            'Shape tonal balance with modest, source-specific band moves.',
            ['Start with cuts or moves within ±6 dB, then level-match bypass before judging.'],
            ['Band frequency selects the area, Q sets its width, and gain sets the amount of change.'],
            ['Narrow boosts can ring, exaggerate resonances, and consume headroom.'],
            {
                availability: 'unavailable',
                reason: 'EQ has no automatic output compensation; level-match bypass manually.',
            }
        ),
        // No fallback: every parameter below is authored by hand.
        undefined,
        {
            'eq-low-gain': parameterGuidance(
                'Low-band gain',
                'Boosts or cuts the low-frequency foundation of the source.',
                -4,
                4,
                [
                    'eq-low-freq sets where this acts and eq-low-q sets how tightly: dial in eq-low-freq and eq-low-q before pushing eq-low-gain far from zero.',
                ],
                ['Large boosts build mud against a kick or bass on the same band.'],
                noExternalModulation
            ),
            'eq-low-freq': parameterGuidance(
                'Low-band center frequency',
                'Selects the bass region that the low band shapes.',
                60,
                180,
                [
                    'eq-low-gain sets how much changes here and eq-low-q sets how tightly: nail this center before raising eq-low-gain or narrowing eq-low-q.',
                ],
                ['Very low centers can mask kick and bass fundamentals.'],
                noExternalModulation
            ),
            'eq-low-q': parameterGuidance(
                'Low-band Q',
                'Sets how narrowly the low-band gain targets the bass region.',
                0.5,
                2,
                [
                    'eq-low-freq places the center this width surrounds, and eq-low-gain sets the amount it narrows: raise eq-low-q only after eq-low-gain is set.',
                ],
                ['A narrow eq-low-q with a large boost can ring or boom at the center frequency.'],
                noExternalModulation
            ),
            'eq-mid-gain': parameterGuidance(
                'Mid-band gain',
                'Boosts or cuts the selected midrange emphasis.',
                -6,
                6,
                [
                    'eq-mid-freq selects the material this changes and eq-mid-q sets its focus: set eq-mid-freq and eq-mid-q before pushing this far.',
                ],
                ['Boosts can add harshness and use output headroom.'],
                noExternalModulation
            ),
            'eq-mid-freq': parameterGuidance(
                'Mid-band center frequency',
                'Selects the midrange region that the mid band shapes.',
                400,
                4000,
                [
                    'eq-mid-gain sets the amount applied here and eq-mid-q sets its width: choose this center before dialing in eq-mid-gain.',
                ],
                ['Placing this near vocal presence with a large cut can dull intelligibility.'],
                noExternalModulation
            ),
            'eq-mid-q': parameterGuidance(
                'Mid-band Q',
                'Sets how narrowly the mid-band gain is focused.',
                0.7,
                3,
                [
                    'eq-mid-freq places the center this narrows around, and eq-mid-gain sets the amount: widen eq-mid-q before eq-mid-gain reaches extremes.',
                ],
                ['A narrow eq-mid-q with a strong cut can sound phasey or nasal.'],
                noExternalModulation
            ),
            'eq-high-gain': parameterGuidance(
                'High-band gain',
                'Boosts or cuts top-end air and sheen.',
                -4,
                6,
                [
                    'eq-high-freq sets where this acts and eq-high-q sets how tightly: set eq-high-freq before pushing eq-high-gain.',
                ],
                ['Boosts above a few dB can add sibilance or amplify noise floor.'],
                noExternalModulation
            ),
            'eq-high-freq': parameterGuidance(
                'High-band center frequency',
                'Selects the treble region that the high band shapes.',
                6000,
                14000,
                [
                    'eq-high-gain sets the amount changed here and eq-high-q sets its width: choose this center before raising eq-high-gain.',
                ],
                ['Too low a corner can dull the midrange presence instead of adding air.'],
                noExternalModulation
            ),
            'eq-high-q': parameterGuidance(
                'High-band Q',
                'Sets how narrowly the high-band gain is focused.',
                0.5,
                3,
                [
                    'eq-high-freq places the center this narrows and eq-high-gain sets the amount: use with eq-high-freq and eq-high-gain.',
                ],
                ['High eq-high-q can isolate and exaggerate a harsh resonance.'],
                noExternalModulation
            ),
        }
    ),
    descriptorGuidance(
        'builtin-compressor',
        effectGuidance(
            'Control dynamic range while preserving the source envelope.',
            ['Level-match makeup gain against bypass and watch for pumping.'],
            ['Threshold and ratio set reduction; attack and release shape the envelope response.'],
            ['Fast timing or excessive makeup can flatten transients and clip later stages.'],
            {
                availability: 'provided',
                parameterId: 'comp-makeup',
                detail: 'Makeup gain restores deliberate level after compression.',
            }
        ),
        // No fallback: every parameter below is authored by hand.
        undefined,
        {
            'comp-threshold': parameterGuidance(
                'Compression threshold',
                'Sets the input level where gain reduction begins.',
                -30,
                -12,
                [
                    'comp-ratio sets how hard reduction bites once past this point, and comp-knee sets how gradually it starts: set comp-ratio and comp-knee together with this.',
                ],
                ['Low thresholds can over-compress program material and remove dynamic contrast.'],
                noExternalModulation
            ),
            'comp-ratio': parameterGuidance(
                'Compression ratio',
                'Sets how strongly signal above threshold is reduced.',
                2,
                6,
                [
                    'comp-threshold sets where reduction starts and comp-knee sets how gradually this ratio engages: raise comp-ratio only after comp-threshold is set.',
                ],
                ['High ratios can make transients and ambience sound constrained or squashed.'],
                noExternalModulation
            ),
            'comp-attack': parameterGuidance(
                'Compression attack time',
                'Sets how quickly gain reduction catches transients.',
                5,
                30,
                [
                    'comp-release sets how the envelope recovers after this catches a peak: balance comp-attack against comp-release to avoid audible pumping.',
                ],
                ['Very fast attacks can remove punch by catching the transient itself.'],
                noExternalModulation
            ),
            'comp-release': parameterGuidance(
                'Compression release time',
                'Sets how quickly gain reduction recovers after peaks.',
                50,
                250,
                [
                    'comp-attack sets how quickly reduction engages before this recovers it: set comp-attack against comp-release and the source tempo.',
                ],
                ['Very short releases can distort low-frequency material by modulating within a cycle.'],
                noExternalModulation
            ),
            'comp-knee': parameterGuidance(
                'Compression knee width',
                'Sets how gradually gain reduction ramps in around the threshold.',
                2,
                10,
                [
                    'comp-threshold sets the center this knee widens around: raise this to soften transitions near comp-threshold on program material.',
                ],
                ['A wide knee can start reducing gain well below comp-threshold, softening perceived punch.'],
                noExternalModulation
            ),
            'comp-makeup': parameterGuidance(
                'Makeup gain',
                'Restores output level after intentional gain reduction.',
                0,
                6,
                [
                    'comp-threshold and comp-ratio set how much level this needs to restore: level-match comp-makeup against bypass after those are set.',
                ],
                ['Excess makeup can clip later devices in the chain.'],
                noExternalModulation
            ),
        }
    ),
    descriptorGuidance(
        'builtin-reverb',
        effectGuidance(
            'Place a source in an artificial acoustic space with controlled wet level.',
            ['Use wet mix conservatively and compare in the full arrangement.'],
            ['Size and decay determine tail density; damping and low cut determine tonal balance.'],
            ['Long or bright tails can obscure rhythm and accumulate low-frequency energy.'],
            {
                availability: 'not-applicable',
                reason: 'This reverb declares no automatic wet-path output compensation.',
            }
        ),
        // No fallback: every parameter below is authored by hand.
        undefined,
        {
            'rev-size': parameterGuidance(
                'Reverb room size',
                'Sets the perceived size of the simulated space.',
                0.3,
                0.7,
                [
                    'rev-decay sets how long this space rings and rev-damping sets its brightness: set rev-size before tuning rev-decay.',
                ],
                ['A large room size with long rev-decay can build low-frequency density.'],
                noExternalModulation
            ),
            'rev-decay': parameterGuidance(
                'Reverb decay time',
                'Sets how long the reverb tail takes to fade to silence.',
                0.8,
                4,
                [
                    'rev-size sets the space this tail rings in and rev-damping sets its tonal fade: raise rev-decay only after rev-size is set.',
                ],
                ['Long decay times can mask timing and rhythmic detail in a dense mix.'],
                noExternalModulation
            ),
            'rev-damping': parameterGuidance(
                'Reverb high-frequency damping',
                'Sets how quickly high frequencies fade within the tail.',
                0.4,
                0.8,
                [
                    'rev-decay sets the overall tail length that rev-damping shapes the brightness of: raise rev-damping to tame a bright rev-decay.',
                ],
                ['Low damping on a long decay can leave a harsh, metallic tail.'],
                noExternalModulation
            ),
            'rev-predelay': parameterGuidance(
                'Reverb pre-delay',
                'Sets the gap between the dry source and the first reflection.',
                20,
                80,
                [
                    "rev-mix sets how audible the tail this delays is: raise rev-predelay to separate the source from rev-mix's wet tail.",
                ],
                ['Long pre-delay can detach the tail from the source and sound like a separate echo.'],
                noExternalModulation
            ),
            'rev-lowcut': parameterGuidance(
                'Reverb tail low cut',
                'Removes low-frequency content from the reverb tail before it sums with the source.',
                100,
                400,
                [
                    'rev-mix sets how much of this filtered tail is audible: raise rev-lowcut before raising rev-mix on bass-heavy sources.',
                ],
                ['Too little low cut lets the tail build mud under a bass-heavy source.'],
                noExternalModulation
            ),
            'rev-mix': parameterGuidance(
                'Reverb wet mix',
                'Sets the proportion of reverberated signal in the output.',
                0.1,
                0.35,
                [
                    'rev-size and rev-decay set the character this proportion of signal carries: balance rev-mix after rev-size and rev-decay are set.',
                ],
                ['High wet mix can push a source behind the arrangement.'],
                noExternalModulation
            ),
        }
    ),
    descriptorGuidance(
        'builtin-delay',
        effectGuidance(
            'Create rhythmic repeats while keeping feedback and wet level under control.',
            ['Increase feedback gradually and leave headroom for repeat accumulation.'],
            ['Delay time establishes rhythm; feedback establishes repeat count; filters shape repeat tone.'],
            ['High feedback can build unexpectedly and mask the dry signal.'],
            { availability: 'not-applicable', reason: 'This delay declares no automatic repeat-level compensation.' }
        ),
        // No fallback: every parameter below is authored by hand.
        undefined,
        {
            'delay-time': parameterGuidance(
                'Delay time',
                'Sets the spacing between repeated echoes.',
                80,
                750,
                [
                    'delay-feedback sets how many repeats follow the spacing this sets: choose delay-time before raising delay-feedback for rhythmic density.',
                ],
                ['Long unsynced times can clutter rhythmic material against the tempo.'],
                noExternalModulation
            ),
            'delay-feedback': parameterGuidance(
                'Delay feedback',
                'Sets how much delayed signal returns for additional repeats.',
                0.15,
                0.65,
                [
                    'delay-time sets the spacing each repeat this feeds back inherits: raise delay-feedback only after delay-time is set.',
                ],
                ['High feedback values can run away toward self-oscillation or mask the dry signal.'],
                noExternalModulation
            ),
            'delay-lowcut': parameterGuidance(
                'Delay repeat low cut',
                'Removes low-frequency content from each repeat so they thin out over time.',
                100,
                500,
                [
                    "delay-highcut sets the other edge of the repeat's tone: set delay-lowcut and delay-highcut together to shape the echo band.",
                ],
                ['Too little low cut lets repeats accumulate low-frequency buildup with delay-feedback.'],
                noExternalModulation
            ),
            'delay-highcut': parameterGuidance(
                'Delay repeat high cut',
                'Darkens each repeat so later echoes read as further away.',
                4000,
                10000,
                [
                    "delay-lowcut sets the other edge of the repeat's tone: lower delay-highcut to push repeats further behind the dry signal.",
                ],
                ['Too aggressive a cut can make repeats disappear entirely at high delay-feedback.'],
                noExternalModulation
            ),
            'delay-mix': parameterGuidance(
                'Delay wet mix',
                'Sets the proportion of delayed signal blended with the dry source.',
                0.15,
                0.4,
                [
                    'delay-feedback sets how many repeats this proportion of signal carries: balance delay-mix after delay-feedback is set.',
                ],
                ['High wet mix with high delay-feedback can overwhelm the dry signal.'],
                noExternalModulation
            ),
        }
    ),
    descriptorGuidance(
        'builtin-gain',
        effectGuidance(
            'Trim a signal deliberately before the next processing stage.',
            ['Watch downstream headroom when adding gain.'],
            ['Use with later dynamics processors to establish staging.'],
            ['Positive gain can clip a later device even when this control itself is clean.'],
            {
                availability: 'not-applicable',
                reason: 'A gain utility is the level control itself, not automatic compensation.',
            }
        ),
        // No fallback: every parameter below is authored by hand.
        undefined,
        {
            'gain-level': parameterGuidance(
                'Output trim level',
                'Raises or lowers the signal level entering the next device.',
                -6,
                6,
                ['Set this before any downstream dynamics processor so its own threshold sees the intended level.'],
                ['Positive trim can clip a later device even when this stage remains clean.'],
                noExternalModulation
            ),
        }
    ),
    descriptorGuidance(
        'builtin-sidechain-compressor',
        effectGuidance(
            'Apply sidechain-aware compression when a supported routing source is connected.',
            ['Confirm sidechain routing before relying on ducking and level-match makeup gain.'],
            ['Threshold and ratio react to the sidechain path while attack and release set the ducking envelope.'],
            ['Incorrect routing or excessive makeup can create unstable level changes.'],
            {
                availability: 'provided',
                parameterId: 'sc-comp-makeup',
                detail: 'Makeup gain restores deliberate level after sidechain reduction.',
            }
        ),
        // No fallback: every parameter below is authored by hand.
        undefined,
        {
            'sc-comp-threshold': parameterGuidance(
                'Sidechain ducking threshold',
                'Sets the sidechain input level where ducking begins.',
                -30,
                -10,
                [
                    'sc-comp-ratio sets how hard ducking bites once the sidechain source crosses this: set sc-comp-ratio after sc-comp-threshold.',
                ],
                ['A low threshold ducks on quiet sidechain hits, chattering on busy material.'],
                noExternalModulation
            ),
            'sc-comp-ratio': parameterGuidance(
                'Sidechain ducking ratio',
                'Sets how deeply the source ducks once the sidechain crosses threshold.',
                3,
                10,
                [
                    'sc-comp-threshold sets where this ratio starts applying: raise sc-comp-ratio only after sc-comp-threshold is confirmed with routing.',
                ],
                ['High ratios can remove musical attacks from the ducked source entirely.'],
                noExternalModulation
            ),
            'sc-comp-attack': parameterGuidance(
                'Sidechain ducking attack time',
                'Sets how quickly the duck engages after the sidechain source hits.',
                3,
                20,
                [
                    'sc-comp-release sets how the duck recovers after sc-comp-attack engages it: balance the two against the sidechain source tempo.',
                ],
                ["Very fast attack can remove the punch of the ducked source's own transient."],
                noExternalModulation
            ),
            'sc-comp-release': parameterGuidance(
                'Sidechain ducking release time',
                'Sets how quickly the ducked source recovers between sidechain hits.',
                60,
                300,
                [
                    "sc-comp-attack sets how quickly the duck engages before sc-comp-release recovers it: match sc-comp-release to the sidechain source's rhythm.",
                ],
                ['Too short a release can pump audibly in time with a busy sidechain source.'],
                noExternalModulation
            ),
            'sc-comp-makeup': parameterGuidance(
                'Sidechain ducking makeup gain',
                'Restores level lost to ducking after the sidechain event passes.',
                0,
                5,
                [
                    'sc-comp-threshold and sc-comp-ratio set how much ducking this restores: level-match sc-comp-makeup against bypass.',
                ],
                ['Excess makeup can clip once the sidechain event passes and ducking releases.'],
                noExternalModulation
            ),
        }
    ),
    descriptorGuidance(
        'builtin-chorus',
        effectGuidance(
            'Add moving detune and width to a source.',
            ['Keep wet depth moderate to preserve pitch focus.'],
            ['Rate and depth set movement; feedback and mix set density.'],
            ['High depth can blur pitch and mono compatibility.'],
            {
                availability: 'not-applicable',
                reason: 'This modulation effect declares no automatic level compensation.',
            }
        ),
        // No fallback: every parameter below is authored by hand.
        undefined,
        {
            'chorus-rate': parameterGuidance(
                'Chorus LFO rate',
                'Sets how fast the detuned voice sweeps.',
                0.3,
                2,
                [
                    'chorus-depth sets how far this sweep travels: raise chorus-rate only after chorus-depth is set to keep the motion musical.',
                ],
                ['Fast rates with deep chorus-depth can sound seasick rather than lush.'],
                noExternalModulation
            ),
            'chorus-depth': parameterGuidance(
                'Chorus sweep depth',
                'Sets how far the detuned voice pitch-shifts as it sweeps.',
                2,
                8,
                [
                    'chorus-rate sets how fast this sweep travels and chorus-feedback thickens it: balance chorus-depth against chorus-rate first.',
                ],
                ['Deep sweeps can blur pitch focus and mono compatibility.'],
                noExternalModulation
            ),
            'chorus-feedback': parameterGuidance(
                'Chorus feedback amount',
                'Sets how much detuned signal recirculates for a denser, more resonant chorus.',
                0.05,
                0.3,
                [
                    'chorus-depth sets the sweep this recirculates and chorus-mix sets its audibility: raise chorus-feedback gradually after chorus-depth is set.',
                ],
                ['High feedback can add metallic comb-filter coloration.'],
                noExternalModulation
            ),
            'chorus-mix': parameterGuidance(
                'Chorus wet mix',
                'Sets the proportion of chorused signal blended with the dry source.',
                0.3,
                0.6,
                [
                    'chorus-depth and chorus-feedback set the character this proportion carries: set those before chorus-mix.',
                ],
                ['High wet mix can collapse pitch focus on a solo instrument.'],
                noExternalModulation
            ),
        }
    ),
    descriptorGuidance(
        'builtin-phaser',
        effectGuidance(
            'Sweep phase-cancelled bands for motion and color.',
            ['Use feedback sparingly on bright sources.'],
            ['Rate and depth control the sweep; feedback increases resonance.'],
            ['High feedback can create sharp resonances.'],
            { availability: 'not-applicable', reason: 'This phase effect declares no automatic level compensation.' }
        ),
        // No fallback: every parameter below is authored by hand.
        undefined,
        {
            'phaser-rate': parameterGuidance(
                'Phaser sweep rate',
                'Sets how fast the notches sweep across the spectrum.',
                0.1,
                1.5,
                [
                    'phaser-depth sets how far the notches this rate sweeps travel: set phaser-depth before raising phaser-rate.',
                ],
                ['Fast rates with high phaser-feedback can sound warbly and seasick.'],
                noExternalModulation
            ),
            'phaser-depth': parameterGuidance(
                'Phaser sweep depth',
                'Sets how far the notch frequencies travel during the sweep.',
                0.3,
                0.8,
                [
                    'phaser-rate sets how fast this sweep travels and phaser-stages sets the notch count: balance phaser-depth against phaser-stages.',
                ],
                ['Full depth with many phaser-stages can sound like a dramatic sweep rather than subtle motion.'],
                noExternalModulation
            ),
            'phaser-feedback': parameterGuidance(
                'Phaser resonance amount',
                'Sets how sharply the notches resonate as they sweep.',
                0.1,
                0.4,
                [
                    'phaser-stages sets how many notches this sharpens: raise phaser-feedback cautiously with a high phaser-stages count.',
                ],
                ['High feedback can create sharp, piercing resonant peaks.'],
                noExternalModulation
            ),
            'phaser-stages': parameterGuidance(
                'Phaser notch stage count',
                'Sets how many all-pass stages create notches, thickening the effect.',
                4,
                8,
                [
                    'phaser-feedback sets how sharp each notch this adds resonates: raise phaser-stages before increasing phaser-feedback further.',
                ],
                ['High stage counts with fast phaser-rate can create a chaotic-sounding sweep.'],
                noExternalModulation
            ),
        }
    ),
    descriptorGuidance(
        'builtin-distortion',
        effectGuidance(
            'Add harmonic saturation while staging output into later devices.',
            ['Lower output after increasing drive and compare bypass at matched level.'],
            ['Drive creates harmonics; tone filters them; output and mix set level and blend.'],
            ['High drive can alias, lose transients, and overload later stages.'],
            { availability: 'unavailable', reason: 'This distortion declares no automatic loudness matching.' }
        ),
        // No fallback: every parameter below is authored by hand.
        undefined,
        {
            'dist-drive': parameterGuidance(
                'Distortion drive amount',
                'Sets how much the signal overdrives into harmonic saturation.',
                10,
                40,
                [
                    'dist-tone shapes the harmonics this generates and dist-output stages the result: set dist-drive before dist-tone and dist-output.',
                ],
                ['High drive can alias and strip transients before later devices even see the signal.'],
                noExternalModulation
            ),
            'dist-tone': parameterGuidance(
                'Distortion tone filter',
                'Sets the brightness of the generated harmonic content.',
                1500,
                4500,
                [
                    'dist-drive sets how much harmonic content this filters and dist-mix sets its audibility: adjust dist-tone after setting dist-drive.',
                ],
                ['A bright dist-tone with high dist-drive can sound harsh and fatiguing.'],
                noExternalModulation
            ),
            'dist-output': parameterGuidance(
                'Distortion output trim',
                'Lowers the level after saturation to stage into later devices.',
                -12,
                -2,
                [
                    'dist-drive raises level that this trims back down: lower dist-output after raising dist-drive to level-match against bypass.',
                ],
                ['Insufficient dist-output trim after heavy dist-drive can overload later stages.'],
                noExternalModulation
            ),
            'dist-mix': parameterGuidance(
                'Distortion wet/dry blend',
                'Sets the proportion of distorted signal blended with the clean source.',
                0.3,
                0.7,
                [
                    'dist-drive sets the character this proportion of signal carries: set dist-drive and dist-tone before dist-mix.',
                ],
                ['High wet mix on a clean source loses all of the original transient.'],
                noExternalModulation
            ),
        }
    ),
    descriptorGuidance(
        'builtin-limiter',
        effectGuidance(
            'Catch peaks near a chosen output ceiling.',
            ['Leave ceiling margin for later conversion and compare against bypass.'],
            ['Threshold drives reduction while release controls recovery and ceiling caps output.'],
            ['Heavy limiting can flatten transients and raise apparent loudness deceptively.'],
            { availability: 'unavailable', reason: 'This limiter declares no automatic loudness matching.' }
        ),
        // No fallback: every parameter below is authored by hand.
        undefined,
        {
            'lim-threshold': parameterGuidance(
                'Limiter threshold',
                'Sets the input level above which the limiter begins catching peaks.',
                -10,
                -2,
                [
                    'lim-ceiling sets the hard output cap this reduction aims for and lim-release sets recovery speed: drive lim-threshold down only after lim-ceiling is set.',
                ],
                ["Driving the threshold far below the program's peaks can flatten transients audibly."],
                noExternalModulation
            ),
            'lim-release': parameterGuidance(
                'Limiter release time',
                'Sets how quickly gain recovers after the limiter catches a peak.',
                30,
                150,
                [
                    'lim-threshold sets how often this recovery is triggered: match lim-release to program tempo once lim-threshold is set.',
                ],
                ['Very fast release can distort low-frequency peaks by recovering within a cycle.'],
                noExternalModulation
            ),
            'lim-ceiling': parameterGuidance(
                'Limiter output ceiling',
                'Sets the hard maximum output level the limiter will not exceed.',
                -1,
                -0.1,
                [
                    'lim-threshold sets how much reduction reaches this cap: set lim-ceiling before driving lim-threshold down.',
                ],
                ['A ceiling too close to 0 dB can clip on inter-sample peaks after conversion.'],
                noExternalModulation
            ),
        }
    ),
    descriptorGuidance(
        'builtin-flanger',
        effectGuidance(
            'Create short comb-filter motion for color.',
            ['Keep feedback restrained on full-range material.'],
            ['Rate and depth sweep the delay; feedback increases comb resonance.'],
            ['High feedback can cause metallic peaks and level build-up.'],
            { availability: 'not-applicable', reason: 'This flanger declares no automatic level compensation.' }
        ),
        // No fallback: every parameter below is authored by hand.
        undefined,
        {
            'flanger-rate': parameterGuidance(
                'Flanger sweep rate',
                'Sets how fast the short delay sweeps to create the comb-filter motion.',
                0.1,
                0.8,
                [
                    'flanger-depth sets how far this sweep travels and flanger-feedback sharpens the resulting comb: set flanger-depth before raising flanger-rate.',
                ],
                ['Fast rates with deep flanger-depth can sound like a siren rather than subtle motion.'],
                noExternalModulation
            ),
            'flanger-depth': parameterGuidance(
                'Flanger sweep depth',
                'Sets how far the short delay time sweeps, widening the comb spacing.',
                1,
                4,
                [
                    'flanger-rate sets how fast this sweep travels and flanger-feedback resonates the comb: balance flanger-depth against flanger-feedback.',
                ],
                ['Deep sweeps with high flanger-feedback can produce metallic peaks and level build-up.'],
                noExternalModulation
            ),
            'flanger-feedback': parameterGuidance(
                'Flanger resonance amount',
                'Sets how sharply the comb-filter notches resonate.',
                0.15,
                0.6,
                [
                    'flanger-depth sets the comb spacing this resonates and flanger-mix sets its audibility: raise flanger-feedback after flanger-depth is set.',
                ],
                ['High feedback can create sharp metallic peaks and runaway level build-up.'],
                noExternalModulation
            ),
            'flanger-mix': parameterGuidance(
                'Flanger wet mix',
                'Sets the proportion of flanged signal blended with the dry source.',
                0.3,
                0.6,
                [
                    'flanger-depth and flanger-feedback set the character this proportion carries: set those first, then flanger-mix.',
                ],
                ['High wet mix at full flanger-feedback can sound harsh rather than subtle.'],
                noExternalModulation
            ),
        }
    ),
    descriptorGuidance(
        'builtin-tremolo',
        effectGuidance(
            'Impose rhythmic amplitude movement on a source.',
            ['Keep depth below full mute unless a hard chop is intentional.'],
            ['Rate sets rhythm, depth sets level movement, and shape sets contour.'],
            ['Full depth can remove note audibility between pulses.'],
            {
                availability: 'not-applicable',
                reason: 'This amplitude effect declares no automatic level compensation.',
            }
        ),
        // No fallback: every parameter below is authored by hand.
        undefined,
        {
            'trem-rate': parameterGuidance(
                'Tremolo pulse rate',
                'Sets how fast the amplitude pulses.',
                1,
                8,
                [
                    'trem-depth sets how deep each pulse this rate creates goes: set trem-depth before tuning trem-rate to the tempo.',
                ],
                ['Fast rates with full trem-depth can sound like distortion rather than rhythm.'],
                noExternalModulation
            ),
            'trem-depth': parameterGuidance(
                'Tremolo pulse depth',
                'Sets how far the amplitude dips on each pulse.',
                0.2,
                0.7,
                [
                    'trem-rate sets the pulse this depth affects and trem-shape sets its contour: set trem-rate before pushing trem-depth toward full.',
                ],
                ['Full depth removes note audibility between pulses entirely.'],
                noExternalModulation
            ),
            'trem-shape': parameterGuidance(
                'Tremolo waveform shape',
                'Sets whether the amplitude pulse is a smooth sine or a hard on/off square.',
                0,
                0,
                [
                    'trem-rate and trem-depth set the rhythm this contour shapes: choose trem-shape after trem-rate and trem-depth are set.',
                ],
                ['Square shape at fast trem-rate can produce audible clicking at each transition.'],
                noExternalModulation
            ),
        }
    ),
    descriptorGuidance(
        'builtin-bitcrusher',
        effectGuidance(
            'Reduce resolution for deliberate digital texture.',
            ['Blend wet signal conservatively and reduce output if harshness increases level.'],
            ['Bit depth and sample rate set degradation; mix sets blend.'],
            ['Extreme reduction can add harsh aliases and obscure pitch.'],
            { availability: 'unavailable', reason: 'This bitcrusher declares no automatic loudness compensation.' }
        ),
        // No fallback: every parameter below is authored by hand.
        undefined,
        {
            'crush-bits': parameterGuidance(
                'Bitcrusher bit depth',
                'Sets the quantization resolution, adding grit as it drops.',
                3,
                7,
                [
                    'crush-rate sets the other axis of degradation alongside this: lower crush-bits before crush-rate for a controlled lo-fi texture.',
                ],
                ['Very low bit depth can obscure pitch and add harsh quantization noise.'],
                noExternalModulation
            ),
            'crush-rate': parameterGuidance(
                'Bitcrusher sample-rate reduction',
                'Sets how much the effective sample rate drops, adding aliased artifacts.',
                2,
                15,
                [
                    'crush-bits sets the other axis of degradation alongside this: combine crush-rate with crush-bits for the intended texture.',
                ],
                ['High rate reduction creates harsh aliased frequencies that can obscure pitch.'],
                noExternalModulation
            ),
            'crush-mix': parameterGuidance(
                'Bitcrusher wet blend',
                'Sets the proportion of degraded signal blended with the clean source.',
                0.2,
                0.6,
                ['crush-bits and crush-rate set the character this proportion carries: set those before crush-mix.'],
                ['High wet mix at extreme crush-bits settings can raise perceived noise floor.'],
                noExternalModulation
            ),
        }
    ),
    descriptorGuidance(
        'builtin-filter',
        effectGuidance(
            'Shape spectral balance with a resonant filter.',
            ['Raise resonance gradually and level-match after strong filtering.'],
            ['Cutoff selects the transition region; resonance emphasizes it; type selects topology.'],
            ['High resonance can whistle or overemphasize a narrow frequency.'],
            { availability: 'unavailable', reason: 'This filter declares no automatic output compensation.' }
        ),
        // No fallback: every parameter below is authored by hand.
        undefined,
        {
            'filter-cutoff': parameterGuidance(
                'Filter cutoff frequency',
                'Sets the frequency where the selected filter topology begins acting.',
                200,
                4000,
                [
                    'filter-resonance emphasizes the region around this cutoff and filter-type sets the topology: set filter-type before sweeping filter-cutoff.',
                ],
                ['Sweeping cutoff with high filter-resonance can produce a loud whistling peak.'],
                noExternalModulation
            ),
            'filter-resonance': parameterGuidance(
                'Filter resonance amount',
                'Sets how much the filter emphasizes the region at the cutoff.',
                0.5,
                3,
                [
                    'filter-cutoff sets the frequency this emphasizes: keep filter-resonance moderate while sweeping filter-cutoff.',
                ],
                ['High resonance can self-oscillate or overemphasize a narrow frequency.'],
                noExternalModulation
            ),
            'filter-type': parameterGuidance(
                'Filter topology selector',
                'Chooses which frequencies the filter removes relative to the cutoff.',
                0,
                0,
                [
                    'filter-cutoff and filter-resonance apply relative to whichever topology this selects: choose filter-type before tuning filter-cutoff and filter-resonance.',
                ],
                ['Switching topology while automation drives filter-cutoff can produce an abrupt tonal jump.'],
                noExternalModulation
            ),
        }
    ),
    descriptorGuidance(
        'builtin-autopan',
        effectGuidance(
            'Move a source across the stereo field rhythmically.',
            ['Check mono compatibility before using wide depth on critical material.'],
            ['Rate sets movement, depth sets width, and shape sets contour.'],
            ['Extreme depth can make a source unstable in mono.'],
            { availability: 'not-applicable', reason: 'This pan effect declares no automatic level compensation.' }
        ),
        // No fallback: every parameter below is authored by hand.
        undefined,
        {
            'autopan-rate': parameterGuidance(
                'Auto-pan sweep rate',
                'Sets how fast the source moves across the stereo field.',
                0.3,
                2,
                [
                    'autopan-depth sets how wide this sweep travels: set autopan-depth before tuning autopan-rate to the tempo.',
                ],
                ['Fast rates with deep autopan-depth can sound disorienting rather than musical.'],
                noExternalModulation
            ),
            'autopan-depth': parameterGuidance(
                'Auto-pan sweep width',
                'Sets how far left and right the source travels.',
                0.3,
                0.8,
                [
                    'autopan-rate sets how fast this width sweeps and autopan-shape sets its contour: balance autopan-depth against autopan-rate.',
                ],
                ['Full depth can make a source unstable or disappear entirely in mono.'],
                noExternalModulation
            ),
            'autopan-shape': parameterGuidance(
                'Auto-pan waveform shape',
                'Sets whether the pan sweep eases smoothly or moves at a constant rate between extremes.',
                0,
                0,
                [
                    'autopan-rate and autopan-depth set the sweep this contour shapes: choose autopan-shape after those are set.',
                ],
                ['Triangle shape at fast autopan-rate can sound abrupt at the stereo extremes.'],
                noExternalModulation
            ),
        }
    ),
    descriptorGuidance(
        'builtin-convolution-reverb',
        effectGuidance(
            'Place a source in an impulse-response space.',
            ['Use wet mix and pre-delay conservatively while checking arrangement masking.'],
            ['Impulse choice supplies character; filters and mix shape its placement.'],
            ['Long bright impulses can obscure rhythm and build low-frequency energy.'],
            {
                availability: 'not-applicable',
                reason: 'This convolution reverb declares no automatic wet-path compensation.',
            }
        ),
        // No fallback: every parameter below is authored by hand.
        undefined,
        {
            'conv-ir': parameterGuidance(
                'Convolution impulse response selection',
                'Chooses the captured space that colors the reverb character.',
                0,
                3,
                [
                    'conv-mix sets how audible this chosen space is: choose conv-ir before tuning conv-mix and the tone filters.',
                ],
                ['Switching to a long, bright impulse without lowering conv-mix can suddenly dominate the mix.'],
                noExternalModulation
            ),
            'conv-mix': parameterGuidance(
                'Convolution wet mix',
                'Sets the proportion of the convolved signal blended with the dry source.',
                0.2,
                0.45,
                ['conv-ir sets the character this proportion carries: set conv-ir before tuning conv-mix.'],
                ['High wet mix with a long conv-ir can obscure rhythmic detail.'],
                noExternalModulation
            ),
            'conv-predelay': parameterGuidance(
                'Convolution pre-delay',
                'Sets the gap between the dry source and the first reflection of the impulse.',
                20,
                80,
                [
                    'conv-mix sets how audible the delayed tail this creates is: raise conv-predelay to separate source from a dense conv-ir.',
                ],
                ['Long pre-delay can detach the impulse tail from the source like a separate echo.'],
                noExternalModulation
            ),
            'conv-lowcut': parameterGuidance(
                'Convolution tail low cut',
                'Removes low-frequency content from the impulse tail.',
                40,
                150,
                ["conv-highcut sets the other edge of the tail's tone: set conv-lowcut and conv-highcut together."],
                ['Too little low cut lets a bright conv-ir build low-frequency mud.'],
                noExternalModulation
            ),
            'conv-highcut': parameterGuidance(
                'Convolution tail high cut',
                'Darkens the impulse tail, reducing its perceived brightness.',
                5000,
                12000,
                ["conv-lowcut sets the other edge of the tail's tone: lower conv-highcut to tame a bright conv-ir."],
                ['Too aggressive a cut can make an otherwise detailed conv-ir sound muffled.'],
                noExternalModulation
            ),
        }
    ),
    descriptorGuidance(
        'builtin-stereo-widener',
        effectGuidance(
            'Adjust stereo width while preserving a stable low-frequency center.',
            ['Check mono compatibility after widening.'],
            ['Width, mid/side balance, and mono-bass setting jointly determine stereo stability.'],
            ['Excess width can collapse or cancel in mono.'],
            { availability: 'not-applicable', reason: 'This width effect declares no automatic level compensation.' }
        ),
        // No fallback: every parameter below is authored by hand.
        undefined,
        {
            'width-amount': parameterGuidance(
                'Stereo width amount',
                'Sets how much wider or narrower the stereo image becomes.',
                0.8,
                1.5,
                [
                    'width-mono-bass keeps the low end stable while this widens the rest: raise width-amount together with a conservative width-mono-bass.',
                ],
                ['Excess width can collapse or cancel entirely when summed to mono.'],
                noExternalModulation
            ),
            'width-mid': parameterGuidance(
                'Stereo mid-channel level',
                'Sets the level of the mono-compatible center content.',
                -2,
                3,
                [
                    'width-side sets the level of the complementary side content: balance width-mid against width-side to avoid an unbalanced image.',
                ],
                ['Cutting mid level while boosting side content can make the center feel hollow.'],
                noExternalModulation
            ),
            'width-side': parameterGuidance(
                'Stereo side-channel level',
                'Sets the level of the stereo difference content.',
                0,
                4,
                [
                    'width-mid sets the level of the complementary center content: raise width-side gradually while watching width-mid balance.',
                ],
                ['Boosting side level too far can cause phase cancellation in mono.'],
                noExternalModulation
            ),
            'width-mono-bass': parameterGuidance(
                'Stereo mono-bass crossover',
                'Sets the frequency below which stereo content is summed to mono for a stable low end.',
                60,
                180,
                [
                    'width-amount sets how wide the material above this crossover becomes: raise width-mono-bass before pushing width-amount far from unity.',
                ],
                ['Too low a crossover leaves wide bass content unstable in mono playback.'],
                noExternalModulation
            ),
        }
    ),
    descriptorGuidance(
        'builtin-deesser',
        effectGuidance(
            'Reduce excessive sibilance while preserving intelligibility.',
            ['Use listen mode to locate the sibilant band, then turn it off before judging.'],
            ['Frequency selects the band while threshold and range set reduction.'],
            ['Over-reduction can dull consonants and make vocals lisp.'],
            { availability: 'unavailable', reason: 'This de-esser declares no automatic output compensation.' }
        ),
        // No fallback: every parameter below is authored by hand.
        undefined,
        {
            'deess-threshold': parameterGuidance(
                'De-esser threshold',
                'Sets the sibilant-band level where reduction begins.',
                -26,
                -14,
                [
                    'deess-freq sets the band this threshold listens to and deess-range sets the depth: confirm deess-freq before setting deess-threshold.',
                ],
                ['A low threshold catches non-sibilant consonants, dulling articulation.'],
                noExternalModulation
            ),
            'deess-freq': parameterGuidance(
                'De-esser detection frequency',
                'Sets the center of the sibilant band being monitored and reduced.',
                5000,
                7500,
                [
                    'deess-listen previews this exact band and deess-threshold reacts to it: use deess-listen to confirm deess-freq before setting deess-threshold.',
                ],
                ['A mistuned frequency can miss the actual sibilance or catch cymbals and hi-hats instead.'],
                noExternalModulation
            ),
            'deess-range': parameterGuidance(
                'De-esser maximum reduction',
                'Caps how much the sibilant band can be pulled down even on the harshest hit.',
                -16,
                -6,
                [
                    'deess-threshold sets how often this cap is reached: set deess-threshold before widening deess-range.',
                ],
                ['Too deep a range can make sibilants disappear entirely, sounding lisped.'],
                noExternalModulation
            ),
            'deess-listen': parameterGuidance(
                'De-esser sidechain listen',
                'Solos the detected sibilant band so you can confirm placement by ear.',
                0,
                0,
                [
                    'deess-freq sets the band this solos: enable deess-listen while adjusting deess-freq, then disable it before judging deess-threshold.',
                ],
                [
                    'Leaving deess-listen enabled during mixdown would export the solo band instead of the processed audio.',
                ],
                noExternalModulation
            ),
        }
    ),
    descriptorGuidance(
        'builtin-lufs-meter',
        analysisGuidance(
            'Measure loudness against a delivery target without changing audio.',
            ['Treat readings as metering evidence, not a gain command.'],
            ['Target and window choose the comparison context for the measured loudness.'],
            ['Chasing short-term readings can cause unnecessary level changes.'],
            { availability: 'not-applicable', reason: 'This analyzer has no audio gain path to compensate.' }
        ),
        // No fallback: every parameter below is authored by hand.
        undefined,
        {
            'lufs-target': parameterGuidance(
                'Loudness delivery target',
                'Sets the reference LUFS the meter compares the measured level against.',
                -18,
                -11,
                [
                    'lufs-window sets which time constant the measurement compares against this target: choose lufs-window before reading against lufs-target.',
                ],
                ['Chasing a target meant for one delivery platform can misrepresent loudness for another.'],
                noExternalModulation
            ),
            'lufs-window': parameterGuidance(
                'Loudness measurement window',
                'Sets the time constant the meter integrates over before reporting a reading.',
                1,
                2,
                [
                    'lufs-target sets what the reading from this window is compared against: read lufs-window against lufs-target before finalizing delivery.',
                ],
                [
                    'Reading a momentary window as if it were the integrated loudness misrepresents overall program level.',
                ],
                noExternalModulation
            ),
        }
    ),
];

export const BUILTIN_EFFECT_DESCRIPTORS = applyDescriptorGuidance(
    BUILTIN_EFFECT_DESCRIPTOR_DATA,
    BUILTIN_EFFECT_DESCRIPTORS_GUIDANCE
);
