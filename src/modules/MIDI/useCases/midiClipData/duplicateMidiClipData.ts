import { midiStore } from '../../stores/midiStore';

type DuplicateMidiClipDataInput = {
    copies: readonly { sourceClipId: string; targetClipId: string }[];
};

export function duplicateMidiClipData({ copies }: DuplicateMidiClipDataInput): void {
    if (copies.length === 0) {
        return;
    }

    const state = midiStore.value;
    if (state === null) {
        return;
    }

    const notesByClipId = { ...state.notesByClipId };
    const ccByClipId = { ...state.ccByClipId };
    const pitchBendByClipId = { ...state.pitchBendByClipId };
    let hasDuplicatedData = false;

    for (const { sourceClipId, targetClipId } of copies) {
        const sourceNotes = state.notesByClipId[sourceClipId];
        if (sourceNotes !== undefined && sourceNotes.length > 0) {
            notesByClipId[targetClipId] = sourceNotes.map((note) => ({
                ...note,
                id: `note-dup-${crypto.randomUUID().slice(0, 8)}`,
            }));
            hasDuplicatedData = true;
        }

        const sourceControlChanges = state.ccByClipId[sourceClipId];
        if (sourceControlChanges !== undefined && sourceControlChanges.length > 0) {
            ccByClipId[targetClipId] = sourceControlChanges.map((controlChange) => ({
                ...controlChange,
                id: `cc-dup-${crypto.randomUUID().slice(0, 8)}`,
            }));
            hasDuplicatedData = true;
        }

        const sourcePitchBends = state.pitchBendByClipId[sourceClipId];
        if (sourcePitchBends !== undefined && sourcePitchBends.length > 0) {
            pitchBendByClipId[targetClipId] = sourcePitchBends.map((pitchBend) => ({
                ...pitchBend,
                id: `pb-dup-${crypto.randomUUID().slice(0, 8)}`,
            }));
            hasDuplicatedData = true;
        }
    }

    if (!hasDuplicatedData) {
        return;
    }

    midiStore.set({ ...state, notesByClipId, ccByClipId, pitchBendByClipId });
}
