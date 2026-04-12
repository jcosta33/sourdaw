import { midiStore } from '../../stores/midiStore';

export function removeMidiCC(clipId: string, ccId: string): void {
    const state = midiStore.value;
    if (!state) {
        return;
    }

    const existing = state.ccByClipId[clipId];
    if (!existing) {
        return;
    }

    midiStore.set({
        ...state,
        ccByClipId: {
            ...state.ccByClipId,
            [clipId]: existing.filter((c) => c.id !== ccId),
        },
    });
}
