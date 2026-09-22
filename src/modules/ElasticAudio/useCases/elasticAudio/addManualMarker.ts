import { addWarpMarker, getWarpState, setWarpState } from '#/modules/Arrangement/stores';
import { pushUndoEntry } from '#/modules/Command/useCases';

export function addManualMarker(clipId: string, localBeat: number): void {
    const before = getWarpState(clipId);
    const snapshot = { ...before, markers: [...before.markers] };

    addWarpMarker(clipId, localBeat, localBeat, { origin: 'user' });

    const afterSnapshot = getWarpState(clipId);
    const nextMarkers = [...afterSnapshot.markers];

    pushUndoEntry(
        'Add elastic marker',
        () => {
            setWarpState(clipId, snapshot);
        },
        () => {
            setWarpState(clipId, { ...afterSnapshot, markers: nextMarkers });
        }
    );
}
