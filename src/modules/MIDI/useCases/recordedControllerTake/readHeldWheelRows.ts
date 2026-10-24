import { MPE_FIRST_MEMBER_CHANNEL } from '../../models/MidiControllerState';
import { createMidiPitchBend, type MidiPitchBend } from '../../models/MidiNote';
import { channelPitchBendState } from '../../repositories/webMidi/channelPitchBendState';
import { getMpeEnabled } from '../../repositories/webMidi/getMpeEnabled';

/**
 * The pitch wheels held off centre on the live input right now that the live
 * route would record, as bend rows at clip beat 0, channel by channel. A wheel
 * at rest has no row, like a pedal at rest, and neither has an MPE member
 * channel, whose bend is per-note data the take records on the note
 * (`handleWebMidiPitchBend` records only the other channels' bends).
 */
export function readHeldWheelRows(): MidiPitchBend[] {
    const mpeEnabled = getMpeEnabled();
    const channels = [...channelPitchBendState].sort(([first], [second]) => first - second);
    return channels
        .filter(([channel, value]) => value !== 0 && !(mpeEnabled && channel >= MPE_FIRST_MEMBER_CHANNEL))
        .map(([channel, value]) => createMidiPitchBend(value, 0, channel));
}
