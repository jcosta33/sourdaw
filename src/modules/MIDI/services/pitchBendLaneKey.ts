import { type MidiPitchBend } from '../models/MidiNote';

/**
 * The lane a pitch-bend row's value carries along: one channel's rows of one scope (`MidiPitchBend.channelScoped`).
 * A recorded wheel bends only the notes of its channel and every other row bends them all, so a note of another
 * channel still hears a channel's unscoped row in force where that channel's scoped row is later, and a carry
 * across a cut or onto a window start keeps both.
 */
export function pitchBendLaneKey(row: Pick<MidiPitchBend, 'channel' | 'channelScoped'>): string {
    return `${row.channel}:${row.channelScoped === true ? 'scoped' : 'unscoped'}`;
}
