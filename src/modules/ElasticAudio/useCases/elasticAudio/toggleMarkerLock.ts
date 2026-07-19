import { warpStates } from '#/modules/Arrangement/stores';
import { runLegacyCommandMutation } from '#/modules/Command/useCases';

function findOwningClip(markerId: string): string | null {
    for (const [clipId, state] of warpStates) {
        if (state.markers.some((m) => m.id === markerId)) {
            return clipId;
        }
    }
    return null;
}

export function toggleMarkerLock(
    markerId: string,
    runMutation: typeof runLegacyCommandMutation = runLegacyCommandMutation
): void {
    void runMutation((pushUndoEntry) => {
        const clipId = findOwningClip(markerId);
        if (clipId === null) {
            return;
        }
        const before = warpStates.get(clipId);
        if (!before) {
            return;
        }
        const beforeSnapshot = { ...before, markers: [...before.markers] };

        const nextMarkers = before.markers.map((m) => (m.id === markerId ? { ...m, locked: !(m.locked ?? false) } : m));
        const nextState = { ...before, markers: nextMarkers };
        warpStates.set(clipId, nextState);

        pushUndoEntry(
            'Toggle elastic marker lock',
            () => {
                warpStates.set(clipId, beforeSnapshot);
            },
            () => {
                warpStates.set(clipId, { ...nextState, markers: [...nextMarkers] });
            }
        );
    });
}
