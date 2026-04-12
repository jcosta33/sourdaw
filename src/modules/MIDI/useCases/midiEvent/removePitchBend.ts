import { midiStore } from '../../stores/midiStore';

export function removePitchBend(clipId: string, pbId: string): void {
    const state = midiStore.value;
    if (!state) {
        return;
    }

    const existing = state.pitchBendByClipId[clipId];
    if (!existing) {
        return;
    }

    midiStore.set({
        ...state,
        pitchBendByClipId: {
            ...state.pitchBendByClipId,
            [clipId]: existing.filter((pb) => pb.id !== pbId),
        },
    });
}
