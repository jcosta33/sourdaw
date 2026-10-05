import { type MidiCC } from '../../models/MidiNote';
import { midiStore } from '../../stores/midiStore';

export function restoreMidiCCPoints(clipId: string, points: readonly MidiCC[]): void {
    const state = midiStore.value;
    if (!state) {
        return;
    }

    // Undo restores the gesture's own rows without the add path's key dedupe;
    // rows the gesture did not touch are never overwritten.
    const existing = state.ccByClipId[clipId] ?? [];
    const restored = [...existing];
    for (const point of points) {
        if (!restored.some((row) => row.id === point.id)) {
            restored.push(point);
        }
    }

    midiStore.set({
        ...state,
        ccByClipId: {
            ...state.ccByClipId,
            [clipId]: restored,
        },
    });
}
