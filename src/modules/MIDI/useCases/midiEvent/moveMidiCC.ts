import { midiStore } from '../../stores/midiStore';

export function moveMidiCC(clipId: string, ccId: string, newBeat: number, newValue: number): void {
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
            [clipId]: existing.map((c) =>
                c.id === ccId ? { ...c, beat: Math.max(0, newBeat), value: Math.max(0, Math.min(127, newValue)) } : c
            ),
        },
    });
}
