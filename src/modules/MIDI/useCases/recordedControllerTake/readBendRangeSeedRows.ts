import { getMidiLearnState } from '#/modules/ControlSurface/useCases';

import { CC_RPN_MSB, MPE_FIRST_MEMBER_CHANNEL, STANDARD_BEND_RANGE_SEMITONES } from '../../models/MidiControllerState';
import { createMidiCC, type MidiCC } from '../../models/MidiNote';
import { channelControllerState } from '../../repositories/webMidi/channelControllerState';
import { getMpeEnabled } from '../../repositories/webMidi/getMpeEnabled';
import { declareChannelState } from '../../services/registeredParameterState';
import { admitsRecordedControlChange } from '../webMidiInput/recordedControlChangeAdmission';

/**
 * The pitch-bend range each channel of the live input has declared, as the RPN
 * 0 declaration that sets it, at clip beat 0, channel by channel.
 *
 * A stored bend is the wire delta alone and its depth is read from the clip's own
 * RPN rows, so a range the keyboard declared before the take began would play at
 * the default. The declaration is the channel's whole registered-parameter state
 * (`declareChannelState`): the range, and the selection the keyboard left, the Null
 * RPN included, so a Data Entry the take records afterwards means what it meant
 * live. A channel on the default range has none, and neither has one the live route
 * would not record (the same admission rule the starting pedals are read by) or an
 * MPE member channel, whose bend is per-note data and never a channel row.
 */
export function readBendRangeSeedRows(): MidiCC[] {
    const learnState = getMidiLearnState();
    const mpeEnabled = getMpeEnabled();
    const channels = [...channelControllerState].sort(([first], [second]) => first - second);
    return channels.flatMap(([channel, state]) => {
        const range = state.bendRangeSemitones;
        if (range === undefined || range === STANDARD_BEND_RANGE_SEMITONES) {
            return [];
        }
        if (mpeEnabled && channel >= MPE_FIRST_MEMBER_CHANNEL) {
            return [];
        }
        const admitted = admitsRecordedControlChange({
            learnState,
            mpeEnabled,
            channel,
            cc: CC_RPN_MSB,
            resolvedCc: CC_RPN_MSB,
            consumed: true,
        });
        if (!admitted) {
            return [];
        }
        return declareChannelState(state).map(({ controller, value }) => createMidiCC(controller, value, 0, channel));
    });
}
