import { type MidiCC } from '../../models/MidiNote';
import { midiStore } from '../../stores/midiStore';

export function restoreMidiCCPoints(clipId: string, points: readonly MidiCC[]): void {
    const state = midiStore.value;
    if (!state) {
        return;
    }

    midiStore.set({
        ...state,
        ccByClipId: {
            ...state.ccByClipId,
            // No key dedupe: undo must return the clip to its exact pre-click
            // contents, and a key may legitimately hold several points.
            [clipId]: [...points],
        },
    });
}
