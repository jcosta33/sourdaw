import { warpStates } from '#/modules/Arrangement/useCases';
import { pushUndoEntry } from '#/modules/Command/stores';

function findOwningClip(markerId: string): string | null {
    for (const [clipId, state] of warpStates) {
        if (state.markers.some((m) => m.id === markerId)) {
            return clipId;
        }
    }
    return null;
}

export function removeMarker(markerId: string): void {
    const clipId = findOwningClip(markerId);
    if (clipId === null) {
        return;
    }
    const before = warpStates.get(clipId);
    if (!before) {
        return;
    }
    const beforeSnapshot = { ...before, markers: [...before.markers] };

    const nextMarkers = before.markers.filter((m) => m.id !== markerId);
    const nextState = { ...before, markers: nextMarkers };
    warpStates.set(clipId, nextState);

    pushUndoEntry(
        'Remove elastic marker',
        () => {
            warpStates.set(clipId, beforeSnapshot);
        },
        () => {
            warpStates.set(clipId, { ...nextState, markers: [...nextMarkers] });
        }
    );
}
