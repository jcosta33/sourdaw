import { descriptorGuidance, parameterGuidance } from './DescriptorGuidance';
import { effectGuidance, NO_SOURCE_SPECIFIC_MODULATION } from './GuidanceProfiles';

export const TRANSIENT_SHAPER_GUIDANCE = descriptorGuidance(
    'transient-shaper',
    effectGuidance(
        'Shape distinguishable drum strikes and tails with independent Attack and Sustain linear gains.',
        [
            'Leave headroom for boosts; compare at matched monitoring level. Gain 1 is unity and gain 0 silences the selected samples.',
        ],
        [
            'A fixed, input-level-dependent pair of envelope followers classifies each channel independently. Bypass re-entry starts fresh detector history. Browser automation is sample-rate; native automation uses existing block-boundary step/hold writes.',
        ],
        [
            'This is not a gate or stereo-linked detector. Stereo image can move; quiet or already-squashed sources may not separate into useful strikes and tails.',
        ],
        { availability: 'unavailable', reason: 'No automatic gain compensation or output limiter is provided.' }
    ),
    undefined,
    {
        attackGain: parameterGuidance(
            'Transient linear gain',
            'Raises or softens samples classified as the strike.',
            0.75,
            1.25,
            ['sustainGain controls the other samples; both at 1 preserve finite audio while warming the detector.'],
            [
                'Boosting to 2 can double transient amplitude and clip downstream. The detector is input-level dependent.',
            ],
            NO_SOURCE_SPECIFIC_MODULATION
        ),
        sustainGain: parameterGuidance(
            'Sustain linear gain',
            'Raises or shortens samples classified as the body and tail.',
            0.75,
            1.25,
            ['attackGain controls the strike; this gain does not change detector timing or threshold.'],
            ['Low values can truncate useful body; independent channels can change the stereo image.'],
            NO_SOURCE_SPECIFIC_MODULATION
        ),
    }
);
