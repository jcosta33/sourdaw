import { type MidiCC } from '../../models/MidiNote';
import { midiStore } from '../../stores/midiStore';

/**
 * Puts `points` back without the add path's key dedupe; rows the gesture did not touch are never overwritten.
 *
 * `previousOrder` is the clip's rows as they stood before the gesture. Each missing point goes back ahead of the
 * first surviving row that followed it there, because the range reader breaks same-beat ties by array order and a
 * return pulled onto the beat of the clip's own first row must stay ahead of that row. Without it, or for a point
 * with no surviving successor, the point is appended.
 */
export function restoreMidiCCPoints(
    clipId: string,
    points: readonly MidiCC[],
    previousOrder: readonly { id: string }[] = []
): void {
    const state = midiStore.value;
    if (!state) {
        return;
    }

    const restored = Array.from(state.ccByClipId[clipId] ?? []);
    const orderedIds = previousOrder.map(({ id }) => id);
    for (const point of points) {
        if (restored.some((row) => row.id === point.id)) {
            continue;
        }
        const previousIndex = orderedIds.indexOf(point.id);
        const followers = previousIndex === -1 ? [] : orderedIds.slice(previousIndex + 1);
        const successorIndex = restored.findIndex((row) => followers.includes(row.id));
        restored.splice(successorIndex === -1 ? restored.length : successorIndex, 0, point);
    }

    midiStore.set({
        ...state,
        ccByClipId: {
            ...state.ccByClipId,
            [clipId]: restored,
        },
    });
}
