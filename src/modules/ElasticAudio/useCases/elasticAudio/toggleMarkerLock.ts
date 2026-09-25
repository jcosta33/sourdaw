import { getStoredWarpState, setWarpState, warpStateStore } from '#/modules/Arrangement/stores';
import { pushUndoEntry } from '#/modules/Command/useCases';

function findOwningClip(markerId: string): string | null {
    for (const [clipId, state] of Object.entries(warpStateStore.value?.states ?? {})) {
        if (state.markers.some((m) => m.id === markerId)) {
            return clipId;
        }
    }
    return null;
}

export function toggleMarkerLock(markerId: string): void {
    const clipId = findOwningClip(markerId);
    if (clipId === null) {
        return;
    }
    const before = getStoredWarpState(clipId);
    if (!before) {
        return;
    }
    const beforeSnapshot = { ...before, markers: [...before.markers] };

    const nextMarkers = before.markers.map((m) => (m.id === markerId ? { ...m, locked: !(m.locked ?? false) } : m));
    const nextState = { ...before, markers: nextMarkers };
    setWarpState(clipId, nextState);

    pushUndoEntry(
        'Toggle elastic marker lock',
        () => {
            setWarpState(clipId, beforeSnapshot);
        },
        () => {
            setWarpState(clipId, { ...nextState, markers: [...nextMarkers] });
        }
    );
}
