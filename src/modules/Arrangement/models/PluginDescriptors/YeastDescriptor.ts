/**
 * Yeast — MIDI Effects Rack plugin descriptor.
 * Registers Yeast as a MIDI effect that can be added to MIDI tracks.
 */

import { type PluginDescriptor } from '../DeviceParameterTypes';

import { applySingleDescriptorGuidance, descriptorGuidance, parameterGuidance } from './DescriptorGuidance';
import { NO_SOURCE_SPECIFIC_MODULATION, effectGuidance } from './GuidanceProfiles';

const YEAST_DESCRIPTOR_DATA: PluginDescriptor = {
    id: 'yeast',
    name: 'Yeast',
    vendor: 'Sourdaw',
    format: 'builtin',
    category: 'effect',
    hasCustomUI: true,
    parameters: [
        {
            id: 'arp_mode',
            deviceId: 'yeast',
            name: 'Arp Mode',
            type: 'int',
            value: 0,
            defaultValue: 0,
            minValue: 0,
            maxValue: 6,
            unit: '',
            automatable: true,
            hasAutomation: false,
        },
        {
            id: 'arp_rate',
            deviceId: 'yeast',
            name: 'Rate',
            type: 'int',
            value: 8,
            defaultValue: 8,
            minValue: 1,
            maxValue: 32,
            unit: '',
            automatable: true,
            hasAutomation: false,
        },
        {
            id: 'arp_gate',
            deviceId: 'yeast',
            name: 'Gate',
            type: 'float',
            value: 0.8,
            defaultValue: 0.8,
            minValue: 0.01,
            maxValue: 2,
            unit: '',
            automatable: true,
            hasAutomation: false,
        },
        {
            id: 'arp_swing',
            deviceId: 'yeast',
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

const noExternalModulation = NO_SOURCE_SPECIFIC_MODULATION;

export const YEAST_DESCRIPTOR = applySingleDescriptorGuidance(
    YEAST_DESCRIPTOR_DATA,
    descriptorGuidance(
        'yeast',
        effectGuidance(
            'Transform incoming MIDI deliberately before it reaches an instrument.',
            ['Verify the target instrument and note range before enabling transformations.'],
            ['MIDI routing, scale, timing, and velocity controls jointly change generated note events.'],
            ['Unbounded transposition or dense generation can make a performance unplayable.'],
            { availability: 'not-applicable', reason: 'This MIDI effect has no audio output level to compensate.' }
        ),
        // No fallback: every parameter below is authored by hand. The live
        // Arpeggiator processor (`workers/processors/Arpeggiator.ts`) reads
        // its own mode/rate_denom/gate/swing fields by rack processor id, not
        // by this standalone device's parameter ids, so each entry below
        // states that gap rather than describing a wired behaviour that does
        // not exist on this surface.
        undefined,
        {
            arp_mode: parameterGuidance(
                'Arpeggio note-order mode',
                "Chooses which of the arpeggiator's seven ordered playback patterns walks the held notes: up, down, up-down, down-up, random, note-order, or chord.",
                0,
                4,
                ['arp_rate sets how fast this pattern steps and arp_gate sets how long each of its notes holds.'],
                [
                    "The live Arpeggiator processor reads its own per-rack mode value by processor id, not this device-chain parameter, so writes through the standalone Yeast device surface do not currently reach a running arpeggiator's note order.",
                ],
                noExternalModulation
            ),
            arp_rate: parameterGuidance(
                'Arpeggio step rate denominator',
                'Sets the rhythmic subdivision each arpeggio step advances by, as a note-value denominator where 8 is an eighth note and 4 is a quarter note.',
                4,
                16,
                [
                    'arp_swing delays every other step this rate produces, and arp_gate sets what fraction of each resulting step each note sustains.',
                ],
                [
                    "The live Arpeggiator processor reads its own per-rack rate value by processor id, not this device-chain parameter, so writes through the standalone Yeast device surface do not currently reach a running arpeggiator's timing.",
                ],
                noExternalModulation
            ),
            arp_gate: parameterGuidance(
                'Arpeggio note gate length',
                "Sets what fraction of each step's duration a generated note sustains, from a short staccato gap up to a legato overlap into the next step.",
                0.5,
                1.5,
                [
                    'Scales against the step length arp_rate sets, and arp_mode decides which held notes each gated step plays.',
                ],
                [
                    "The live Arpeggiator processor reads its own per-rack gate value by processor id, not this device-chain parameter, so writes through the standalone Yeast device surface do not currently reach a running arpeggiator's note length.",
                ],
                noExternalModulation
            ),
            arp_swing: parameterGuidance(
                'Arpeggio step swing',
                'Delays every second step by up to half a step length to produce a swung rhythmic feel.',
                0,
                0.5,
                [
                    "Only audible on steps arp_rate produces, and interacts with arp_gate since a swung step's note still sustains for its gated fraction of the unswung step length.",
                ],
                [
                    "The live Arpeggiator processor reads its own per-rack swing value by processor id, not this device-chain parameter, so writes through the standalone Yeast device surface do not currently reach a running arpeggiator's timing feel.",
                ],
                noExternalModulation
            ),
        }
    )
);
