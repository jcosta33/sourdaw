import { getMidiLearnState } from '#/modules/ControlSurface/useCases';

import { CC_RPN_MSB } from '../../models/MidiControllerState';
import { type MidiCC } from '../../models/MidiNote';
import { getMpeEnabled } from '../../repositories/webMidi/getMpeEnabled';
import { admitsRecordedControlChange } from '../webMidiInput/recordedControlChangeAdmission';

import { readLiveRegisteredStateRows } from './readLiveRegisteredStateRows';

/**
 * The registered-parameter state each channel of the live input is in, as the
 * declaration that leads a take at clip beat 0, channel by channel.
 *
 * A stored bend is the wire delta alone and its depth is read from the clip's own
 * RPN rows, so a range the keyboard declared before the take began would play at
 * the default. So would a Data Entry the take records while the keyboard left RPN 0
 * selected: heard at the range it sets, replayed with no selection. The declaration
 * is therefore the channel's whole state (`declareChannelState`), not only the
 * range: the range, and the selection the keyboard left, the Null RPN included. A
 * channel whose state is a fresh channel's has none, and neither has one the live
 * route would not record (the same admission rule the starting pedals are read by)
 * or an MPE member channel.
 */
export function readBendRangeSeedRows(): MidiCC[] {
    const learnState = getMidiLearnState();
    const mpeEnabled = getMpeEnabled();
    return readLiveRegisteredStateRows().filter(({ channel }) =>
        admitsRecordedControlChange({
            learnState,
            mpeEnabled,
            channel,
            cc: CC_RPN_MSB,
            resolvedCc: CC_RPN_MSB,
            consumed: true,
        })
    );
}
