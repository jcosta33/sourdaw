/**
 * Toaster — drum machine plugin descriptor.
 * Registers Toaster as a proper instrument that can be added to MIDI tracks.
 */

import { type PluginDescriptor } from '../DeviceParameterTypes';

import { applySingleDescriptorGuidance, descriptorGuidance } from './DescriptorGuidance';
import { declaredControl, instrumentGuidance } from './GuidanceProfiles';

const TOASTER_DESCRIPTOR_DATA: PluginDescriptor = {
    id: 'toaster',
    name: 'Toaster',
    vendor: 'Sourdaw',
    format: 'builtin',
    category: 'instrument',
    hasCustomUI: true,
    // Toaster's global send effects are persisted inside its opaque kit state,
    // not in the generic parameter map. Reverb and delay run in parallel; each
    // declaration follows the coefficient/time law used by the Rust engine.
    tail: {
        kind: 'parallel',
        tails: [
            {
                kind: 'stateFeedbackLoop',
                feedbackPath: ['data', 'kit', 'reverbDecay'],
                defaultFeedback: 0.5,
                minFeedback: 0.1,
                maxFeedback: 0.99,
                loopUnit: 's',
                defaultLoopSeconds: 1812 / 44_100,
                enabledPath: ['data', 'kit', 'reverbMix'],
                defaultEnabledValue: 0.15,
                automatableEnabledParameterId: 'reverbMix',
                stateGuard: { path: ['version'], equals: 1 },
            },
            {
                kind: 'stateFeedbackLoop',
                feedbackPath: ['data', 'kit', 'delayFeedback'],
                defaultFeedback: 0.35,
                maxFeedback: 0.95,
                loopPath: ['data', 'kit', 'delayTime'],
                loopUnit: 'ms',
                defaultLoopSeconds: 0.375,
                minLoopSeconds: 1 / 44_100,
                maxLoopSeconds: 2,
                enabledPath: ['data', 'kit', 'delayMix'],
                defaultEnabledValue: 0,
                automatableEnabledParameterId: 'delayMix',
                stateGuard: { path: ['version'], equals: 1 },
            },
        ],
    },
    parameters: [
        {
            id: 'masterGain',
            deviceId: 'toaster',
            name: 'Master',
            type: 'float',
            value: 1,
            defaultValue: 1,
            minValue: 0,
            maxValue: 2,
            unit: '',
            automatable: true,
            hasAutomation: false,
        },
        {
            id: 'reverbMix',
            deviceId: 'toaster',
            name: 'Reverb',
            type: 'float',
            value: 0.15,
            defaultValue: 0.15,
            minValue: 0,
            maxValue: 1,
            unit: '',
            automatable: true,
            hasAutomation: false,
        },
        {
            id: 'delayMix',
            deviceId: 'toaster',
            name: 'Delay',
            type: 'float',
            value: 0,
            defaultValue: 0,
            minValue: 0,
            maxValue: 1,
            unit: '',
            automatable: true,
            hasAutomation: false,
        },
        {
            id: 'swing',
            deviceId: 'toaster',
            name: 'Swing',
            type: 'float',
            value: 0,
            defaultValue: 0,
            minValue: 0,
            maxValue: 1,
            unit: '',
            automatable: true,
            hasAutomation: false,
        },
    ],
};

export const TOASTER_DESCRIPTOR = applySingleDescriptorGuidance(
    TOASTER_DESCRIPTOR_DATA,
    descriptorGuidance(
        'toaster',
        instrumentGuidance(
            'Program a drum pattern, then balance kit, send, and master controls against the track.',
            ['Check master and send levels before printing or exporting a pattern.'],
            ['Kit voices, sequencing, and opaque-kit send effects combine at the instrument output.'],
            ['Dense patterns and high master level can overload downstream buses.']
        ),
        declaredControl(
            'Drum-machine control',
            'Changes pattern, kit, voice, or output behavior.',
            ['Balance kit voices before master output.'],
            ['Dense patterns can build output level quickly.']
        )
    )
);
