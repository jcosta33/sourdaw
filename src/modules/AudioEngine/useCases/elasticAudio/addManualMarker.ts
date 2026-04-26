import { addWarpMarker } from '#/modules/Arrangement/useCases';
import { pushUndoEntry } from '#/modules/Command/stores';

import { getWarpState, warpStates } from '#/modules/Arrangement/useCases';

export function addManualMarker(clipId: string, localBeat: number): void {
    const before = getWarpState(clipId);
    const snapshot = { ...before, markers: [...before.markers] };

    addWarpMarker(clipId, localBeat, localBeat, { origin: 'user' });

    const afterSnapshot = getWarpState(clipId);
    const nextMarkers = [...afterSnapshot.markers];

    pushUndoEntry(
        'Add elastic marker',
        () => {
            warpStates.set(clipId, snapshot);
        },
        () => {
            warpStates.set(clipId, { ...afterSnapshot, markers: nextMarkers });
        }
    );
}
