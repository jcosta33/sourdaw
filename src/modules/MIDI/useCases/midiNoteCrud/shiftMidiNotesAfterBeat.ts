import { midiStore } from '../../stores/midiStore';

export type ShiftMidiNotesAfterBeatInput = {
    /** Beat at which the shift window opens. Notes starting at or after this beat move. */
    atBeat: number;
    /** Beats to shift by. Positive = pushed right (insert time). Negative = pulled left (delete time). */
    delta: number;
};

/**
 * Global time-window shift: every MIDI note in every clip whose `startBeat >=
 * atBeat` moves by `delta`. Used when arrangement-level operations insert or
 * remove time from the timeline.
 *
 * Notes and CC/pitch-bend events are stored with absolute beat positions, so
 * when a block of time is inserted at `atBeat`, anything on the right must
 * follow — otherwise the MIDI plays against shifted clip rectangles.
 *
 * Writes once to the store regardless of clip count.
 */
export function shiftMidiNotesAfterBeat(input: ShiftMidiNotesAfterBeatInput): void {
    const { atBeat, delta } = input;
    if (delta === 0) {
        return;
    }

    const state = midiStore.value;
    if (!state) {
        return;
    }

    const nextNotes: typeof state.notesByClipId = {};
    for (const [clipId, notes] of Object.entries(state.notesByClipId)) {
        nextNotes[clipId] = notes.map((node) =>
            node.startBeat >= atBeat ? { ...node, startBeat: node.startBeat + delta } : node
        );
    }

    const nextCc: typeof state.ccByClipId = {};
    for (const [clipId, events] of Object.entries(state.ccByClipId)) {
        nextCc[clipId] = events.map((event) => (event.beat >= atBeat ? { ...event, beat: event.beat + delta } : event));
    }

    const nextPb: typeof state.pitchBendByClipId = {};
    for (const [clipId, events] of Object.entries(state.pitchBendByClipId)) {
        nextPb[clipId] = events.map((event) => (event.beat >= atBeat ? { ...event, beat: event.beat + delta } : event));
    }

    midiStore.set({
        ...state,
        notesByClipId: nextNotes,
        ccByClipId: nextCc,
        pitchBendByClipId: nextPb,
    });
}
