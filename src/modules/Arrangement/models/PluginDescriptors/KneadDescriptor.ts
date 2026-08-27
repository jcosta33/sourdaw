import { type PluginDescriptor } from '../DeviceParameterTypes';

import { applySingleDescriptorGuidance, descriptorGuidance } from './DescriptorGuidance';
import { declaredControl, effectGuidance } from './GuidanceProfiles';

const KNEAD_DESCRIPTOR_DATA: PluginDescriptor = {
    id: 'knead',
    name: 'Knead',
    vendor: 'Sourdaw',
    format: 'builtin',
    category: 'effect',
    // `hasCustomUI` means a track-device panel opened from the inspector.
    // Knead's editor is clip-owned and opened from the clip view instead; it
    // deliberately has no device parameters or track-level panel.
    hasCustomUI: false,
    platform: 'both',
    // Pitch blobs, retune speed, humanize, and formant preservation belong to
    // each clip's Knead state. They are not device parameters or automation
    // targets, so the track-level processor intentionally declares none here.
    parameters: [],
};

export const KNEAD_DESCRIPTOR = applySingleDescriptorGuidance(
    KNEAD_DESCRIPTOR_DATA,
    descriptorGuidance(
        'knead',
        effectGuidance(
            'Apply clip-owned pitch correction from the Knead editor on an audio track.',
            ['Monitor corrected clips at a conservative output level when making large pitch shifts.'],
            ['Clip pitch blobs, scale, retune speed, humanize, and formant preservation shape the correction.'],
            ['Large pitch shifts or aggressive correction can produce audible artifacts.'],
            {
                availability: 'not-applicable',
                reason: 'Knead declares no device-owned output-gain control or automatic gain compensation.',
            }
        ),
        declaredControl(
            'Pitch-correction control',
            'Changes the pitch-correction response for the selected clip.',
            ['Balance correction strength with clip timing and formant preservation.'],
            ['Aggressive values can produce audible pitch or formant artifacts.']
        )
    )
);
