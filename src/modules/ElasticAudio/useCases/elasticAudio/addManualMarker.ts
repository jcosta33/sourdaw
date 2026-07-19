import { addWarpMarker, getWarpState, warpStates } from '#/modules/Arrangement/stores';
import { runLegacyCommandMutation } from '#/modules/Command/useCases';

export function addManualMarker(
    clipId: string,
    localBeat: number,
    runMutation: typeof runLegacyCommandMutation = runLegacyCommandMutation
): void {
    void runMutation((pushUndoEntry) => {
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
    });
}
