import { getStoredWarpState, setWarpState } from '#/modules/Arrangement/stores';
import { pushUndoEntry } from '#/modules/Command/useCases';

export function toggleMarkerLock(ownerClipId: string, markerId: string): void {
    // Warp-marker identity is clip-local (#5570): the toggle targets the clip
    // it was opened on, never the first matching id across the store.
    const before = getStoredWarpState(ownerClipId);
    if (!before || !before.markers.some((m) => m.id === markerId)) {
        return;
    }
    const beforeSnapshot = { ...before, markers: [...before.markers] };

    const nextMarkers = before.markers.map((m) => (m.id === markerId ? { ...m, locked: !(m.locked ?? false) } : m));
    const nextState = { ...before, markers: nextMarkers };
    setWarpState(ownerClipId, nextState);

    pushUndoEntry(
        'Toggle elastic marker lock',
        () => {
            setWarpState(ownerClipId, beforeSnapshot);
        },
        () => {
            setWarpState(ownerClipId, { ...nextState, markers: [...nextMarkers] });
        }
    );
}
