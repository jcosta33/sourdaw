import { isControllerCc, MPE_FIRST_MEMBER_CHANNEL } from '../../models/MidiControllerState';
import { MPE_SLIDE_CC } from '../../models/WebMidiTypes';

import { isCapturedByMidiLearn, type MidiLearnSnapshot } from './isCapturedByMidiLearn';

/** Whether a learned mapping owns the controller, matching what `applyMidiMappings` dispatches to. */
function hasMidiMapping(learnState: MidiLearnSnapshot, channel: number, cc: number): boolean {
    return learnState?.mappings.some((mapping) => mapping.channel === channel && mapping.cc === cc) === true;
}

type RecordedControlChangeAdmissionInput = {
    learnState: MidiLearnSnapshot;
    mpeEnabled: boolean;
    channel: number;
    /** Controller number exactly as it came off the wire. */
    cc: number;
    /** Controller the message resolved to after 14-bit pairing: an LSB half reports its MSB's number. */
    resolvedCc: number;
    /** True when the RPN/NRPN state machine took the message. */
    consumed: boolean;
};

/**
 * Whether a controller message belongs in the take being recorded: the one rule
 * the live route files a message under and the take's starting pedal state is
 * read by, so a pedal seeded at the rising edge is exactly one the route would
 * have recorded had it been pressed then.
 *
 * Out are the messages MIDI learn captures, the channel-mode range (120+), a
 * controller a learned mapping owns (parameter automation), and the MPE slide
 * on a member channel (per-note expression). A message the RPN/NRPN state
 * machine consumed is never mapped and stays in: a replayed sequence needs the
 * wire messages.
 */
export function admitsRecordedControlChange({
    learnState,
    mpeEnabled,
    channel,
    cc,
    resolvedCc,
    consumed,
}: RecordedControlChangeAdmissionInput): boolean {
    if (isCapturedByMidiLearn(learnState) || !isControllerCc(cc)) {
        return false;
    }
    if (!consumed && hasMidiMapping(learnState, channel, resolvedCc)) {
        return false;
    }
    return !(mpeEnabled && cc === MPE_SLIDE_CC && channel >= MPE_FIRST_MEMBER_CHANNEL);
}
