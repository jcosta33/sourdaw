/**
 * Yeast — MIDI Effects Rack plugin descriptor.
 * Registers Yeast as a MIDI effect that can be added to MIDI tracks.
 */

import { type PluginDescriptor } from '../DeviceParameterTypes';

import { applySingleDescriptorGuidance, descriptorGuidance } from './DescriptorGuidance';
import { effectGuidance } from './GuidanceProfiles';

const YEAST_DESCRIPTOR_DATA: PluginDescriptor = {
    id: 'yeast',
    name: 'Yeast',
    vendor: 'Sourdaw',
    format: 'builtin',
    category: 'effect',
    hasCustomUI: true,
    // The rack's processors (and the arpeggiator among them) are configured
    // per rack processor id through the Yeast panel's
    // `setYeastProcessorParam` action, not through device-chain parameters:
    // a rack holds any number of user-added processors addressed by their own
    // ids, so no single device-parameter surface can carry their values.
    // The descriptor therefore declares nothing — a parameter here would be
    // advertised as automatable and planner-discoverable while every write
    // stayed inert (stored state with nothing reading it, #4650).
    parameters: [],
};

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
        // No fallback and no overrides: Yeast declares zero device-owned
        // parameters (processor state lives per rack processor id, edited
        // through the Yeast panel), so there is nothing here for either to
        // cover.
        undefined
    )
);
