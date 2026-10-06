/**
 * The order in which a worklet instrument must receive the events that share one
 * sample frame, in live playback and in an offline render alike.
 *
 * A release comes first: a pedal pressed on the frame a note ends must not catch
 * that note, so the note is already released when the pedal goes down. A stored
 * controller follows, so a note struck on the same frame sounds under the pedal
 * or controller it was recorded with (a pedal pressed with the chord catches the
 * chord; sostenuto, una corda and Levain dynamics apply to the note struck there).
 * A note-on follows the controllers. Expression comes last because the engines
 * address a voice still held on the member channel: an update sorted ahead of its
 * own note-on addresses nothing and the note sounds unexpressed.
 *
 * Both routes read this one table, so the same frame cannot damp a note in one and
 * sustain it in the other. The engines apply a frame's events in the order they
 * arrive and must keep doing so: live MIDI input stamps several performer events
 * on one frame, and their performer order survives only if no queue reorders it.
 */
export type SameFrameEventKind = 'off' | 'control' | 'on' | 'expression';

export const SAME_FRAME_EVENT_ORDER: Readonly<Record<SameFrameEventKind, number>> = {
    off: 0,
    control: 1,
    on: 2,
    expression: 3,
};
