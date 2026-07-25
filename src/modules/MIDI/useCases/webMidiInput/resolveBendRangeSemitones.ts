import { getDefaultBendRangeSemitones } from '#/modules/AudioEngine/useCases';

import {
    MPE_FIRST_MEMBER_CHANNEL,
    MPE_MASTER_CHANNEL,
    STANDARD_BEND_RANGE_SEMITONES,
} from '../../models/MidiControllerState';
import { getChannelBendRangeSemitones } from '../../repositories/webMidi/getChannelBendRangeSemitones';

type ResolveBendRangeSemitonesInput = {
    /** Zero-based MIDI channel the bend arrived on. */
    channel: number;
    /** Whether MPE input handling is active for the current device. */
    mpeEnabled: boolean;
};

/**
 * The bend range to interpret a channel's pitch bend with, in semitones
 * (audit MD-8).
 *
 * This is the *only* place a live bend range is decided. Before RPN 0 existed
 * the two ranges were hard-coded constants at the pitch-bend handler (±2 and
 * ±48) and re-stated in cents for the fallback oscillator; a controller
 * configured to anything else detuned wrong and nothing could tell us.
 *
 * Resolution order:
 *  1. What the channel itself declared via RPN 0.
 *  2. For an MPE member channel, what its zone master declared — MPE sets
 *     pitch-bend sensitivity for the whole zone from the master channel.
 *  3. The MPE member default (±48), taken from the expression surface that
 *     will consume the value so there is one definition of it.
 *  4. Otherwise the MIDI 1.0 default of ±2.
 */
export function resolveBendRangeSemitones({ channel, mpeEnabled }: ResolveBendRangeSemitonesInput): number {
    const declared = getChannelBendRangeSemitones(channel);
    if (declared !== undefined) {
        return declared;
    }

    if (mpeEnabled && channel >= MPE_FIRST_MEMBER_CHANNEL) {
        const zoneMaster = getChannelBendRangeSemitones(MPE_MASTER_CHANNEL);
        if (zoneMaster !== undefined) {
            return zoneMaster;
        }
        return getDefaultBendRangeSemitones();
    }

    return STANDARD_BEND_RANGE_SEMITONES;
}
