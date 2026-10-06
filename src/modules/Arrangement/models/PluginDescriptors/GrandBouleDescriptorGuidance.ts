import { type DeviceParameterGuidance } from '../DeviceParameterTypes';

import { parameterGuidance } from './DescriptorGuidance';
import { NO_SOURCE_SPECIFIC_MODULATION, instrumentGuidance } from './GuidanceProfiles';

/**
 * Guidance for Grand Boule, taken from `crates/daw-dsp/src/grand_boule`.
 *
 * Per sample (`engine.rs` render loop): the voices sum into a bridge bus; the
 * sympathetic bank is driven by that bus and scaled by
 * `sympatheticSend × sympathetic_level × 2` (× 0.3 under una corda); the
 * bridge plus sympathetic output, times `soundboardSend`, feeds the FIR body;
 * dry bridge, body, sympathetic and mechanical noise are summed, shaped by the
 * lid and microphone radiation model (`radiation.rs`), and finally multiplied
 * by `masterGain`.
 */

const noExternalModulation = NO_SOURCE_SPECIFIC_MODULATION;

export const GRAND_BOULE_GUIDANCE = instrumentGuidance(
    'Play a physical-model piano whose summed string signal feeds a soundboard body and a sympathetic string bank, heard through a lid and microphone perspective.',
    [
        'masterGain is the final, unsmoothed output multiplier and ships at 0.1; raise it in small steps rather than jumping it while notes sound.',
    ],
    [
        'soundboardSend scales the bridge and sympathetic signals into the soundboard body, sympatheticSend scales the sympathetic bank, and lidPosition and micPosition shape the radiated result before masterGain.',
    ],
    [
        'The sympathetic bank is driven by every sounding voice, so dense held chords with a high sympatheticSend add resonance on top of the strings themselves.',
    ]
);

export const GRAND_BOULE_PARAMETER_GUIDANCE: Readonly<Record<string, DeviceParameterGuidance>> = {
    masterGain: parameterGuidance(
        'Final output gain',
        'Scales the radiated stereo output directly, with no smoothing, as the last stage before the track; 0.05 to 0.4 spans −6 dB to +12 dB around the shipped 0.1.',
        0.05,
        0.4,
        [
            'Applied after lidPosition and micPosition shape the signal, so it changes level without changing their tonal balance.',
        ],
        [
            'Because it is not smoothed, a sudden jump in masterGain while notes sound steps the output level and can click.',
        ],
        noExternalModulation
    ),
    soundboardSend: parameterGuidance(
        'Input gain into the soundboard body',
        'Scales the summed bridge signal and the sympathetic bank output into the FIR soundboard body, alongside a fixed dry bridge path.',
        0.4,
        0.8,
        [
            'The body input carries the sympathetic output that sympatheticSend sets, so lowering soundboardSend thins both.',
        ],
        [
            'At 0 the body receives nothing, and since the body is the only source of a stereo side signal, the piano collapses to mono.',
        ],
        noExternalModulation
    ),
    sympatheticSend: parameterGuidance(
        'Sympathetic string-bank amount',
        'Scales the sympathetic bank, which resonates with every sounding voice, by sympatheticSend × the model’s sympathetic level × 2; holding the una corda pedal cuts it to 30 percent.',
        0.1,
        0.5,
        ['Its output is added to the dry mix and also sent into the body through soundboardSend.'],
        [
            'At 1 the bank output is scaled by about 1.16 at the default model level, more than unity, so dense held chords stack resonance quickly.',
        ],
        noExternalModulation
    ),
    lidPosition: parameterGuidance(
        'Continuous lid opening',
        'Closing the lid lowers content above 2.5 kHz to 0.3 of open level, content below it to 0.78 and the stereo side to 0.42, smoothed over 20 ms.',
        0.5,
        1,
        [
            'Multiplies with the micPosition perspective, so a closed lid heard from the room perspective darkens furthest (high band 0.64 × 0.3 ≈ 0.19).',
        ],
        ['Low values cut the high band by up to 10.5 dB and narrow the image at the same time.'],
        noExternalModulation
    ),
    micPosition: parameterGuidance(
        'Listening perspective: close, player or room',
        'Rounds to a perspective: 0 (close) lowers the band below 2.5 kHz to 0.82 and the side to 0.86, 1 (player) is neutral, and 2 (room) lowers the low band to 0.9, the high band to 0.64 and the side to 0.62.',
        0,
        1,
        ['Combines multiplicatively with lidPosition, which scales the same three bands.'],
        [
            'The room perspective lowers the high band by about 3.9 dB and the side signal to 0.62, so switching to it mid-arrangement changes tone and width at once.',
        ],
        noExternalModulation
    ),
};
