import { midiStore } from '../../stores/midiStore';

export function removeMidiClipData(clipIds: readonly string[]): void {
    const state = midiStore.value;
    if (!state || clipIds.length === 0) {
        return;
    }

    const clipIdsToRemove = new Set(clipIds);
    let hasMatch = false;

    for (const clipId of clipIdsToRemove) {
        if (
            Object.hasOwn(state.notesByClipId, clipId) ||
            Object.hasOwn(state.ccByClipId, clipId) ||
            Object.hasOwn(state.pitchBendByClipId, clipId)
        ) {
            hasMatch = true;
            break;
        }
    }

    if (!hasMatch) {
        return;
    }

    const notesByClipId = { ...state.notesByClipId };
    const ccByClipId = { ...state.ccByClipId };
    const pitchBendByClipId = { ...state.pitchBendByClipId };

    for (const clipId of clipIdsToRemove) {
        delete notesByClipId[clipId];
        delete ccByClipId[clipId];
        delete pitchBendByClipId[clipId];
    }

    midiStore.set({ ...state, notesByClipId, ccByClipId, pitchBendByClipId });
}
