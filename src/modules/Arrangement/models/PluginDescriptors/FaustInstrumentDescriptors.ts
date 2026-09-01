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
            fp('freq', 'faust-rhodes', 'Freq', 20, 10000, 440, 'Hz'),
            fp('gate', 'faust-rhodes', 'Gate', 0, 1, 0),
        ],
    },
    {
        // Every input control the compiled node exposes, copied from the
        // registration id for id and bound for bound: algorithm, four
        // ratio/level/ADSR operator blocks, gain, and the note-level freq and
        // gate. Declaring these with DSP-side defaults is orthogonal to the FM
        // preset migration (#3155), which maps the retired single-operator
        // preset keys onto them.
        id: 'faust-fm-synth',
        name: 'FM Synth',
        vendor: 'Sourdaw',
        format: 'builtin',
        category: 'instrument',
        hasCustomUI: false,
        tail: {
            kind: 'parallel',
            tails: [
                { kind: 'decaySeconds', parameterId: 'op1_release', defaultSeconds: 0.5 },
                { kind: 'decaySeconds', parameterId: 'op2_release', defaultSeconds: 0.5 },
                { kind: 'decaySeconds', parameterId: 'op3_release', defaultSeconds: 0.5 },
                { kind: 'decaySeconds', parameterId: 'op4_release', defaultSeconds: 0.5 },
            ],
        },
        parameters: [
            fp('algorithm', 'faust-fm-synth', 'Algorithm', 0, 3, 0),
            fp('op1_ratio', 'faust-fm-synth', 'OP1 Ratio', 0.5, 16, 1),
            fp('op1_level', 'faust-fm-synth', 'OP1 Level', 0, 1, 1),
            fp('op1_attack', 'faust-fm-synth', 'OP1 Attack', 0.001, 5, 0.01, 's'),
            fp('op1_decay', 'faust-fm-synth', 'OP1 Decay', 0.01, 5, 0.1, 's'),
            fp('op1_sustain', 'faust-fm-synth', 'OP1 Sustain', 0, 1, 0.8),
            fp('op1_release', 'faust-fm-synth', 'OP1 Release', 0.01, 10, 0.5, 's'),
            fp('op2_ratio', 'faust-fm-synth', 'OP2 Ratio', 0.5, 16, 2),
            fp('op2_level', 'faust-fm-synth', 'OP2 Level', 0, 1, 0.5),
            fp('op2_attack', 'faust-fm-synth', 'OP2 Attack', 0.001, 5, 0.01, 's'),
            fp('op2_decay', 'faust-fm-synth', 'OP2 Decay', 0.01, 5, 0.1, 's'),
            fp('op2_sustain', 'faust-fm-synth', 'OP2 Sustain', 0, 1, 0.8),
            fp('op2_release', 'faust-fm-synth', 'OP2 Release', 0.01, 10, 0.5, 's'),
            fp('op3_ratio', 'faust-fm-synth', 'OP3 Ratio', 0.5, 16, 3),
            fp('op3_level', 'faust-fm-synth', 'OP3 Level', 0, 1, 0.5),
            fp('op3_attack', 'faust-fm-synth', 'OP3 Attack', 0.001, 5, 0.01, 's'),
            fp('op3_decay', 'faust-fm-synth', 'OP3 Decay', 0.01, 5, 0.1, 's'),
            fp('op3_sustain', 'faust-fm-synth', 'OP3 Sustain', 0, 1, 0.8),
            fp('op3_release', 'faust-fm-synth', 'OP3 Release', 0.01, 10, 0.5, 's'),
            fp('op4_ratio', 'faust-fm-synth', 'OP4 Ratio', 0.5, 16, 4),
            fp('op4_level', 'faust-fm-synth', 'OP4 Level', 0, 1, 0.5),
            fp('op4_attack', 'faust-fm-synth', 'OP4 Attack', 0.001, 5, 0.01, 's'),
            fp('op4_decay', 'faust-fm-synth', 'OP4 Decay', 0.01, 5, 0.1, 's'),
            fp('op4_sustain', 'faust-fm-synth', 'OP4 Sustain', 0, 1, 0.8),
            fp('op4_release', 'faust-fm-synth', 'OP4 Release', 0.01, 10, 0.5, 's'),
            fp('gain', 'faust-fm-synth', 'Gain', 0, 1, 0.5),
            fp('freq', 'faust-fm-synth', 'Freq', 20, 10000, 440, 'Hz'),
            fp('gate', 'faust-fm-synth', 'Gate', 0, 1, 0),
        ],
    },
    {
        id: 'faust-supersaw-unison',
        name: 'Supersaw Unison',
        vendor: 'Sourdaw',
        format: 'builtin',
        category: 'instrument',
        hasCustomUI: false,
        tail: { kind: 'decaySeconds', parameterId: 'release', defaultSeconds: 0.5 },
        // The note-level freq and gate sit after the timbre and envelope
        // controls, copied from the registration bound for bound like every
        // entry here. This DSP's freq ceiling is 12000, not the 10000 rhodes
        // and fm-synth declare, because its .dsp says 12000.
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
            fp('freq', 'faust-supersaw-unison', 'Freq', 20, 12000, 440, 'Hz'),
            fp('gate', 'faust-supersaw-unison', 'Gate', 0, 1, 0),
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
