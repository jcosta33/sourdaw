import { type PluginDescriptor, type DeviceParameter } from '../DeviceParameterTypes';

import { applyDescriptorGuidance, descriptorGuidance } from './DescriptorGuidance';
import { declaredControl, effectGuidance } from './GuidanceProfiles';

/**
 * Plugin descriptors for Faust DSP effects.
 *
 * Parameters populated from the known Faust DSP definitions in builtinDSP.ts
 * so the inspector shows controls immediately (before Faust compilation).
 */

function fp(
    id: string,
    deviceId: string,
    name: string,
    min: number,
    max: number,
    defaultValue: number,
    _step: number,
    unit = '',
    scaling?: 'log' | 'linear'
): DeviceParameter {
    return {
        id,
        deviceId,
        name,
        type: 'float',
        value: defaultValue,
        defaultValue,
        minValue: min,
        maxValue: max,
        unit,
        scaling,
        automatable: true,
        hasAutomation: false,
    };
}

const FAUST_EFFECT_DESCRIPTOR_DATA: PluginDescriptor[] = [
    {
        id: 'faust-zita-rev1-reverb',
        name: 'Zita-Rev1 Reverb',
        vendor: 'Sourdaw',
        format: 'builtin',
        category: 'effect',
        hasCustomUI: false,
        tail: { kind: 'decaySeconds', parameterId: 'decay_time', defaultSeconds: 3 },
        parameters: [
            fp('decay_time', 'faust-zita-rev1-reverb', 'Decay Time', 0.1, 15, 3, 0.1, 's', 'log'),
            fp('damping', 'faust-zita-rev1-reverb', 'Damping', 200, 12000, 6000, 100, 'Hz', 'log'),
            fp('dry_wet', 'faust-zita-rev1-reverb', 'Dry/Wet', 0, 1, 0.3, 0.01),
        ],
    },
    {
        id: 'faust-1176-compressor',
        name: '1176 Compressor',
        vendor: 'Sourdaw',
        format: 'builtin',
        category: 'effect',
        hasCustomUI: false,
        parameters: [
            fp('ratio', 'faust-1176-compressor', 'Ratio', 1, 20, 4, 0.1),
            fp('threshold', 'faust-1176-compressor', 'Threshold', -60, 0, -20, 0.1, 'dB'),
            fp('attack', 'faust-1176-compressor', 'Attack', 0.0001, 0.1, 0.001, 0.0001, 's', 'log'),
            fp('release', 'faust-1176-compressor', 'Release', 0.01, 1, 0.1, 0.001, 's', 'log'),
        ],
    },
    {
        id: 'faust-multiband-compressor',
        name: 'Multiband Compressor',
        vendor: 'Sourdaw',
        format: 'builtin',
        category: 'effect',
        hasCustomUI: false,
        parameters: [
            fp('low_threshold', 'faust-multiband-compressor', 'Low Threshold', -60, 0, -20, 0.5, 'dB'),
            fp('mid_threshold', 'faust-multiband-compressor', 'Mid Threshold', -60, 0, -15, 0.5, 'dB'),
            fp('high_threshold', 'faust-multiband-compressor', 'High Threshold', -60, 0, -10, 0.5, 'dB'),
            fp('crossover_low', 'faust-multiband-compressor', 'Low Crossover', 50, 500, 200, 10, 'Hz', 'log'),
            fp('crossover_high', 'faust-multiband-compressor', 'High Crossover', 1000, 10000, 3000, 100, 'Hz', 'log'),
        ],
    },
    {
        id: 'faust-pro-parametric-eq',
        name: 'Pro Parametric EQ',
        vendor: 'Sourdaw',
        format: 'builtin',
        category: 'effect',
        hasCustomUI: false,
        parameters: [
            fp('lf_gain', 'faust-pro-parametric-eq', 'Low Gain', -18, 18, 0, 0.1, 'dB'),
            fp('lf_freq', 'faust-pro-parametric-eq', 'Low Freq', 20, 500, 100, 1, 'Hz', 'log'),
            fp('mf_gain', 'faust-pro-parametric-eq', 'Mid Gain', -18, 18, 0, 0.1, 'dB'),
            fp('mf_freq', 'faust-pro-parametric-eq', 'Mid Freq', 200, 8000, 1000, 1, 'Hz', 'log'),
            fp('mf_q', 'faust-pro-parametric-eq', 'Mid Q', 0.1, 10, 1, 0.1),
            fp('hf_gain', 'faust-pro-parametric-eq', 'High Gain', -18, 18, 0, 0.1, 'dB'),
            fp('hf_freq', 'faust-pro-parametric-eq', 'High Freq', 1000, 20000, 8000, 100, 'Hz', 'log'),
        ],
    },
    {
        id: 'faust-tape-delay',
        name: 'Tape Delay',
        vendor: 'Sourdaw',
        format: 'builtin',
        category: 'effect',
        hasCustomUI: false,
        tail: {
            kind: 'feedbackLoop',
            feedbackParameterId: 'feedback',
            defaultFeedback: 0.5,
            maxFeedback: 0.95,
            loopParameterId: 'delay',
            loopUnit: 's',
            defaultLoopSeconds: 0.3,
        },
        parameters: [
            fp('delay', 'faust-tape-delay', 'Delay Time', 0.01, 2, 0.3, 0.01, 's', 'log'),
            fp('feedback', 'faust-tape-delay', 'Feedback', 0, 0.95, 0.5, 0.01),
            fp('dry_wet', 'faust-tape-delay', 'Dry/Wet', 0, 1, 0.3, 0.01),
        ],
    },
    {
        id: 'faust-brick-wall-limiter',
        name: 'Brick-Wall Limiter',
        vendor: 'Sourdaw',
        format: 'builtin',
        category: 'effect',
        hasCustomUI: false,
        parameters: [
            fp('ceiling', 'faust-brick-wall-limiter', 'Ceiling', -12, 0, -0.3, 0.1, 'dB'),
            fp('release', 'faust-brick-wall-limiter', 'Release', 0.01, 1, 0.1, 0.01, 's', 'log'),
        ],
    },
    {
        id: 'faust-spring-reverb',
        name: 'Spring Reverb',
        vendor: 'Sourdaw',
        format: 'builtin',
        category: 'effect',
        hasCustomUI: false,
        tail: { kind: 'decaySeconds', parameterId: 'decay', defaultSeconds: 2 },
        parameters: [
            fp('decay', 'faust-spring-reverb', 'Decay', 0.1, 10, 2, 0.1, 's', 'log'),
            fp('mix', 'faust-spring-reverb', 'Mix', 0, 1, 0.3, 0.01),
        ],
    },
    {
        id: 'faust-noise-gate',
        name: 'Noise Gate',
        vendor: 'Sourdaw',
        format: 'builtin',
        category: 'effect',
        hasCustomUI: false,
        parameters: [
            fp('threshold', 'faust-noise-gate', 'Threshold', -80, 0, -40, 0.5, 'dB'),
            fp('attack', 'faust-noise-gate', 'Attack', 0.0001, 0.1, 0.001, 0.0001, 's', 'log'),
            fp('release', 'faust-noise-gate', 'Release', 0.01, 1, 0.1, 0.01, 's', 'log'),
        ],
    },
    {
        id: 'faust-gain-utility',
        name: 'Gain Utility',
        vendor: 'Sourdaw',
        format: 'builtin',
        category: 'utility',
        hasCustomUI: false,
        parameters: [fp('gain', 'faust-gain-utility', 'Gain', -60, 12, 0, 0.1, 'dB')],
    },
    {
        id: 'faust-lufs-meter',
        name: 'LUFS Meter',
        vendor: 'Sourdaw',
        format: 'builtin',
        category: 'analyzer',
        hasCustomUI: false,
        parameters: [],
    },
    {
        id: 'faust-stereo-widener',
        name: 'Stereo Widener',
        vendor: 'Sourdaw',
        format: 'builtin',
        category: 'utility',
        hasCustomUI: false,
        parameters: [fp('width', 'faust-stereo-widener', 'Width', 0, 2, 1, 0.01)],
    },
    {
        id: 'faust-de-esser',
        name: 'De-esser',
        vendor: 'Sourdaw',
        format: 'builtin',
        category: 'effect',
        hasCustomUI: false,
        parameters: [
            fp('threshold', 'faust-de-esser', 'Threshold', -40, 0, -15, 0.5, 'dB'),
            fp('frequency', 'faust-de-esser', 'Frequency', 2000, 12000, 6000, 100, 'Hz', 'log'),
            fp('reduction', 'faust-de-esser', 'Reduction', 0, 20, 6, 0.5, 'dB'),
        ],
    },
];

const faustEffectGuidance = effectGuidance(
    'Use the declared Faust effect controls conservatively and level-match against bypass.',
    ['Set wet level or output staging before increasing nonlinear or feedback behavior.'],
    ['Time, tone, dynamics, and wet-path controls interact through the selected Faust algorithm.'],
    ['Extreme settings can build level, mask source detail, or create harsh artifacts.'],
    { availability: 'unavailable', reason: 'These Faust descriptors declare no automatic output compensation.' }
);

const faustControl = declaredControl(
    'Faust effect control',
    'Changes the selected Faust effect response or its wet-path balance.',
    ['Evaluate the control with the algorithm’s other time, tone, or dynamics settings.'],
    ['Extreme settings can build level or obscure source detail.']
);

const FAUST_EFFECT_DESCRIPTORS_GUIDANCE = [
    descriptorGuidance('faust-zita-rev1-reverb', faustEffectGuidance, faustControl),
    descriptorGuidance('faust-1176-compressor', faustEffectGuidance, faustControl),
    descriptorGuidance('faust-multiband-compressor', faustEffectGuidance, faustControl),
    descriptorGuidance('faust-pro-parametric-eq', faustEffectGuidance, faustControl),
    descriptorGuidance('faust-tape-delay', faustEffectGuidance, faustControl),
    descriptorGuidance('faust-brick-wall-limiter', faustEffectGuidance, faustControl),
    descriptorGuidance('faust-spring-reverb', faustEffectGuidance, faustControl),
    descriptorGuidance('faust-noise-gate', faustEffectGuidance, faustControl),
    descriptorGuidance('faust-gain-utility', faustEffectGuidance, faustControl),
    descriptorGuidance(
        'faust-lufs-meter',
        effectGuidance(
            'Measure loudness without changing audio.',
            ['Use meter readings as evidence rather than a gain command.'],
            ['The selected window and target determine how the reading is interpreted.'],
            ['Chasing short-term readings can cause unnecessary processing.'],
            { availability: 'not-applicable', reason: 'This analyzer has no audio level to compensate.' }
        ),
        declaredControl(
            'Loudness-meter configuration',
            'Changes metering configuration without processing audio.',
            ['Choose a window appropriate to the delivery decision.'],
            ['A target does not change measured audio.']
        )
    ),
    descriptorGuidance('faust-stereo-widener', faustEffectGuidance, faustControl),
    descriptorGuidance('faust-de-esser', faustEffectGuidance, faustControl),
];

export const FAUST_EFFECT_DESCRIPTORS = applyDescriptorGuidance(
    FAUST_EFFECT_DESCRIPTOR_DATA,
    FAUST_EFFECT_DESCRIPTORS_GUIDANCE
);
