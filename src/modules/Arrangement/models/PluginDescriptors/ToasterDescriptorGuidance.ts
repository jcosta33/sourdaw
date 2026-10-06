import { type DeviceParameterGuidance } from '../DeviceParameterTypes';

import { parameterGuidance } from './DescriptorGuidance';
import { NO_SOURCE_SPECIFIC_MODULATION, instrumentGuidance } from './GuidanceProfiles';

/**
 * Guidance for Toaster, taken from `crates/daw-dsp/src/toaster/engine.rs` and
 * the host-side swing projections.
 *
 * Per sample each pad voice goes to the master or one of four bus
 * compressors, and its pre-pan signal times the pad's own sends feeds a shared
 * plate reverb and ping-pong delay whose returns are scaled by `reverbMix`
 * and `delayMix`. `masterGain` then multiplies the whole block before the
 * lo-fi stage. `swing` is applied host-side: `projectToasterStepEvents` for
 * the step sequencer and `getToasterSwingOffsetBeats` for clip notes.
 */

const noExternalModulation = NO_SOURCE_SPECIFIC_MODULATION;

export const TOASTER_GUIDANCE = instrumentGuidance(
    'Play the kit’s pads from the built-in step sequencer or from MIDI notes; pad sends feed a shared plate reverb and ping-pong delay, and the bus compressors and a lo-fi stage sit around the master gain.',
    [
        'masterGain multiplies the dry pads, the bus compressors’ output and both send returns before the lo-fi stage, so set it after balancing the pads.',
    ],
    [
        'reverbMix and delayMix set only the return level of the shared effects; how much of each pad reaches them is that pad’s own send in the kit.',
    ],
    [
        'The kit’s delay feedback can reach 0.95, so with delayMix raised the ping-pong repeats keep sounding long after the pattern stops.',
    ]
);

export const TOASTER_PARAMETER_GUIDANCE: Readonly<Record<string, DeviceParameterGuidance>> = {
    masterGain: parameterGuidance(
        'Kit output gain',
        'Multiplies the whole kit, after the bus compressors and send returns, and every routed pad output, before the lo-fi stage.',
        0.5,
        1,
        [
            'Scales the reverbMix and delayMix returns together with the dry pads, so it changes level without changing the wet balance.',
        ],
        ['Above 1 it amplifies the summed kit with no limiter after it, so dense patterns can clip downstream.'],
        noExternalModulation
    ),
    reverbMix: parameterGuidance(
        'Plate reverb return level',
        'Scales the output of the shared four-line plate reverb, which only receives pads whose reverb send is above zero.',
        0,
        0.5,
        [
            'masterGain scales the return with the dry kit, and the kit’s reverb decay (feedback 0.1 to 0.99) sets the tail length reverbMix exposes.',
        ],
        [
            'With every pad’s reverb send at 0 the plate receives nothing, so reverbMix changes nothing audible until a send is raised in the kit.',
        ],
        noExternalModulation
    ),
    delayMix: parameterGuidance(
        'Ping-pong delay return level',
        'Scales the output of the shared stereo ping-pong delay, which only receives pads whose delay send is above zero; 0 mutes the return.',
        0,
        0.4,
        [
            'masterGain scales the return with the dry kit; the kit’s delay time and feedback (up to 0.95) set the repeat spacing and length.',
        ],
        [
            'At the 0.95 feedback ceiling the repeats take about 50 s to fall 60 dB at the default 375 ms delay time, leaving a long tail after the pattern stops.',
        ],
        noExternalModulation
    ),
    swing: parameterGuidance(
        'Off-beat delay for odd steps and odd sixteenths',
        'Delays odd sequencer steps by swing × half a step: about 0.67 gives a 2:1 triplet feel and 1 a 3:1 dotted feel.',
        0,
        0.67,
        [
            'Clip notes played through Toaster move only while an enabled swing automation lane exists, by swing × an eighth of a beat on odd sixteenths.',
            'The delay repeats keep the kit’s fixed delay time, so with delayMix raised the echoes do not follow the swung timing.',
        ],
        [
            'Without an enabled swing automation lane, MIDI clips played through Toaster stay straight while the built-in sequencer swings, so clip parts and sequencer parts disagree in feel.',
        ],
        noExternalModulation
    ),
};
