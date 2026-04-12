import { midiStore } from '../../stores/midiStore';

export function shiftClipMidiNotes(clipId: string, beatDelta: number): void {
    const state = midiStore.value;
    if (!state) {
        return;
    }

    const notes = state.notesByClipId[clipId];
    const ccs = state.ccByClipId[clipId];
    const pbs = state.pitchBendByClipId[clipId];

    if (!notes && !ccs && !pbs) {
        return;
    }

    midiStore.set({
        ...state,
        notesByClipId: notes
            ? { ...state.notesByClipId, [clipId]: notes.map((n) => ({ ...n, startBeat: n.startBeat + beatDelta })) }
            : state.notesByClipId,
        ccByClipId: ccs
            ? { ...state.ccByClipId, [clipId]: ccs.map((c) => ({ ...c, beat: c.beat + beatDelta })) }
            : state.ccByClipId,
        pitchBendByClipId: pbs
            ? { ...state.pitchBendByClipId, [clipId]: pbs.map((p) => ({ ...p, beat: p.beat + beatDelta })) }
            : state.pitchBendByClipId,
    });
}
