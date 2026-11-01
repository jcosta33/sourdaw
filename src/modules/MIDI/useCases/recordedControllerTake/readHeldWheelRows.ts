import { MPE_FIRST_MEMBER_CHANNEL } from '../../models/MidiControllerState';
import { createMidiPitchBend, type MidiPitchBend } from '../../models/MidiNote';
import { channelPitchBendState } from '../../repositories/webMidi/channelPitchBendState';
import { getMpeEnabled } from '../../repositories/webMidi/getMpeEnabled';

/**
 * The pitch wheels held off centre on the live input right now, as the bend rows the live
 * route would record for them, at clip beat 0, channel by channel. A wheel at centre has no
 * row. Neither has an MPE member channel, whose bend is per-note data the take records on the
 * note (`handleWebMidiPitchBend` records a channel row only for the other channels). With MPE
 * off a row is scoped to its own channel; with MPE on the only row is the zone master's, which
 * reaches every channel and is unscoped.
 */
export function readHeldWheelRows(): MidiPitchBend[] {
    const mpeEnabled = getMpeEnabled();
    return [...channelPitchBendState]
        .filter(([channel, value]) => value !== 0 && !(mpeEnabled && channel >= MPE_FIRST_MEMBER_CHANNEL))
        .toSorted(([left], [right]) => left - right)
        .map(([channel, value]) => createMidiPitchBend(value, 0, channel, !mpeEnabled));
}
