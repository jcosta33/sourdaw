import { midiStore } from '../../stores/midiStore';

type GlueMidiClipDataInput = {
    sourceClipIds: readonly string[];
    targetClipId: string;
};

export function glueMidiClipData({ sourceClipIds, targetClipId }: GlueMidiClipDataInput): void {
    const state = midiStore.value;
    if (!state) {
        return;
    }

    const mergedNotes = sourceClipIds.flatMap((clipId) => state.notesByClipId[clipId] ?? []);
    const mergedControlChanges = sourceClipIds.flatMap((clipId) => state.ccByClipId[clipId] ?? []);
    const mergedPitchBends = sourceClipIds.flatMap((clipId) => state.pitchBendByClipId[clipId] ?? []);
    const notesByClipId = { ...state.notesByClipId };
    const ccByClipId = { ...state.ccByClipId };
    const pitchBendByClipId = { ...state.pitchBendByClipId };

    for (const sourceClipId of sourceClipIds) {
        delete notesByClipId[sourceClipId];
        delete ccByClipId[sourceClipId];
        delete pitchBendByClipId[sourceClipId];
    }

    if (mergedNotes.length > 0) {
        notesByClipId[targetClipId] = mergedNotes;
    }
    if (mergedControlChanges.length > 0) {
        ccByClipId[targetClipId] = mergedControlChanges;
    }
    if (mergedPitchBends.length > 0) {
        pitchBendByClipId[targetClipId] = mergedPitchBends;
    }

    midiStore.set({ ...state, notesByClipId, ccByClipId, pitchBendByClipId });
}
