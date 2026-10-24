import { MPE_MASTER_CHANNEL } from '../../models/MidiControllerState';

import { channelPitchBendState } from './channelPitchBendState';

/** The wheels a note-on is struck under, as signed 14-bit wire deltas (0 = centre). */
export type AdmittedChannelWheels = Readonly<{
    /** The wheel of the channel the note is struck on. */
    channel: number;
    /** The MPE zone master's wheel, which a member note starts under. */
    master: number;
}>;

/**
 * The wheels a note-on finds at the instant it is admitted.
 *
 * The note-on can wait in the input queue behind an earlier handler, while the
 * wheel is recorded on admission. Reading the wheel when the handler finally
 * runs would start the note under bends that arrived after it; the queued bend
 * moves the note at its own frame instead.
 */
export function captureAdmittedWheels(channel: number): AdmittedChannelWheels {
    return {
        channel: channelPitchBendState.get(channel) ?? 0,
        master: channelPitchBendState.get(MPE_MASTER_CHANNEL) ?? 0,
    };
}
