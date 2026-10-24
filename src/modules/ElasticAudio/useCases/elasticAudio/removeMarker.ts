import { getStoredWarpState, setWarpState } from '#/modules/Arrangement/stores';
import { pushUndoEntry } from '#/modules/Command/useCases';

export function removeMarker(ownerClipId: string, markerId: string): void {
    // Warp-marker identity is clip-local: duplication, paste and Strip Silence
    // deliberately copy marker ids into independent states, so the edit targets
    // the clip it was opened on and never scans for the first matching id
    // across the store (#5570).
    const before = getStoredWarpState(ownerClipId);
    if (!before || !before.markers.some((m) => m.id === markerId)) {
        return;
    }
    const beforeSnapshot = { ...before, markers: [...before.markers] };

    const nextMarkers = before.markers.filter((m) => m.id !== markerId);
    const nextState = { ...before, markers: nextMarkers };
    setWarpState(ownerClipId, nextState);

    pushUndoEntry(
        'Remove elastic marker',
        () => {
            setWarpState(ownerClipId, beforeSnapshot);
        },
        () => {
            setWarpState(ownerClipId, { ...nextState, markers: [...nextMarkers] });
        }
    );
}
