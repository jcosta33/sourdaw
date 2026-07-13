import { midiStore } from '../../stores/midiStore';

export function removeMidiClipData(clipIds: readonly string[]): void {
    const state = midiStore.value;
    if (!state || clipIds.length === 0) {
        return;
    }

    let notesByClipId = state.notesByClipId;
    let ccByClipId = state.ccByClipId;
    let pitchBendByClipId = state.pitchBendByClipId;

    for (const clipId of new Set(clipIds)) {
        if (Object.hasOwn(notesByClipId, clipId)) {
            if (notesByClipId === state.notesByClipId) {
                notesByClipId = { ...notesByClipId };
            }
            delete notesByClipId[clipId];
        }

        if (Object.hasOwn(ccByClipId, clipId)) {
            if (ccByClipId === state.ccByClipId) {
                ccByClipId = { ...ccByClipId };
            }
            delete ccByClipId[clipId];
        }

        if (Object.hasOwn(pitchBendByClipId, clipId)) {
            if (pitchBendByClipId === state.pitchBendByClipId) {
                pitchBendByClipId = { ...pitchBendByClipId };
            }
            delete pitchBendByClipId[clipId];
        }
    }

    if (
        notesByClipId === state.notesByClipId &&
        ccByClipId === state.ccByClipId &&
        pitchBendByClipId === state.pitchBendByClipId
    ) {
        return;
    }

    midiStore.set({ ...state, notesByClipId, ccByClipId, pitchBendByClipId });
}
