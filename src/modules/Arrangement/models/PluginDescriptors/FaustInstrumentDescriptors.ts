import { type PluginDescriptor, type DeviceParameter } from '../DeviceParameterTypes';

import { applyDescriptorGuidance, descriptorGuidance } from './DescriptorGuidance';
import { declaredControl, instrumentGuidance } from './GuidanceProfiles';

/**
 * Plugin descriptors for Faust DSP instruments.
 *
 * Built the same way FaustEffectDescriptors was built: parameters copied from
 * the live `registerFaustDSP` registrations (PluginHost's builtinDSP.ts and
 * Synth's proSynthInstruments.ts), id for id and bound for bound, so the
 * inspector, the write law, and the command contract all resolve against the
 * controls the compiled node actually accepts.
 */

function fp(
    id: string,
    deviceId: string,
    name: string,
    min: number,
    max: number,
    defaultValue: number,
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

const FAUST_INSTRUMENT_DESCRIPTOR_DATA: PluginDescriptor[] = [
    {
        id: 'faust-rhodes',
        name: 'Rhodes',
        vendor: 'Sourdaw',
        format: 'builtin',
        category: 'instrument',
        hasCustomUI: false,
        // The body envelope governs how long a struck note keeps ringing.
        tail: { kind: 'decaySeconds', parameterId: 'body_decay', defaultSeconds: 1.5 },
        parameters: [
            fp('brightness', 'faust-rhodes', 'Brightness', 0, 1, 0.5),
            fp('body_decay', 'faust-rhodes', 'Body Decay', 0.1, 5, 1.5, 's'),
            fp('bell_decay', 'faust-rhodes', 'Bell Decay', 0.01, 1, 0.15, 's'),
            fp('gain', 'faust-rhodes', 'Gain', 0, 1, 0.5),
        ],
    },
    {
        // The compiled module exposes 26 op-level controls (algorithm plus four
        // ratio/level/ADSR operator blocks). None is declared here yet: every
        // shipped FM preset authors the retired single-operator set
        // (`ratio`, `index`, `attack`, …) whose keys never reach the DSP, so
        // the inspector-level declaration waits on that preset migration
        // deciding the operator mapping. The descriptor still carries the
        // guidance contract, which is what command version capture hashes.
        id: 'faust-fm-synth',
        name: 'FM Synth',
        vendor: 'Sourdaw',
        format: 'builtin',
        category: 'instrument',
        hasCustomUI: false,
        parameters: [],
    },
    {
        id: 'faust-supersaw-unison',
        name: 'Supersaw Unison',
        vendor: 'Sourdaw',
        format: 'builtin',
        category: 'instrument',
        hasCustomUI: false,
        tail: { kind: 'decaySeconds', parameterId: 'release', defaultSeconds: 0.5 },
        parameters: [
            fp('lfo_rate', 'faust-supersaw-unison', 'LFO Rate', 0.1, 20, 5, 'Hz'),
            fp('lfo_depth', 'faust-supersaw-unison', 'LFO Depth', 0, 1, 0),
            fp('detune', 'faust-supersaw-unison', 'Detune (cents)', 0, 100, 15),
            fp('center_mix', 'faust-supersaw-unison', 'Center Mix', 0, 1, 0.7),
            fp('cutoff', 'faust-supersaw-unison', 'Cutoff', 100, 20000, 6000, 'Hz', 'log'),
            fp('resonance', 'faust-supersaw-unison', 'Resonance', 0, 0.99, 0.3),
            fp('attack', 'faust-supersaw-unison', 'Attack', 0.001, 5, 0.01, 's', 'log'),
            fp('decay', 'faust-supersaw-unison', 'Decay', 0.01, 5, 0.3, 's', 'log'),
            fp('sustain', 'faust-supersaw-unison', 'Sustain', 0, 1, 0.8),
            fp('release', 'faust-supersaw-unison', 'Release', 0.01, 10, 0.5, 's', 'log'),
        ],
    },
];

const faustInstrumentGuidance = instrumentGuidance(
    'Play the declared Faust instrument controls conservatively and level-match against bypass.',
    ['Set output gain before increasing brightness, detune, or envelope extremes.'],
    ['Timbre, envelope, and filter controls interact through the selected Faust algorithm.'],
    ['Extreme settings can build level, mask note detail, or create harsh artifacts.']
);

const faustInstrumentControl = declaredControl(
    'Faust instrument control',
    'Changes the selected Faust instrument voice or its output balance.',
    ['Evaluate the control with the algorithm’s other timbre or envelope settings.'],
    ['Extreme settings can build level or obscure note detail.']
);

const FAUST_INSTRUMENT_DESCRIPTORS_GUIDANCE = [
    descriptorGuidance('faust-rhodes', faustInstrumentGuidance, faustInstrumentControl),
    descriptorGuidance('faust-fm-synth', faustInstrumentGuidance, faustInstrumentControl),
    descriptorGuidance('faust-supersaw-unison', faustInstrumentGuidance, faustInstrumentControl),
];

export const FAUST_INSTRUMENT_DESCRIPTORS = applyDescriptorGuidance(
    FAUST_INSTRUMENT_DESCRIPTOR_DATA,
    FAUST_INSTRUMENT_DESCRIPTORS_GUIDANCE
);
