import {
    currentIdentity,
    pianoRollSelectionRuntime,
    resolveOwners,
    type Projection,
} from './pianoRollSelectionRuntime';

export function setPianoRollSelection(
    clipId: string,
    viewIds: readonly string[],
    openedClipIds: readonly string[] = [],
    projections: readonly Projection[] = []
): void {
    pianoRollSelectionRuntime.projectIdentity = currentIdentity();
    if (viewIds.length > 512 || openedClipIds.length > 256 || projections.length > 256) {
        pianoRollSelectionRuntime.selection = {
            clipId,
            clipIds: [],
            viewIds: [],
            status: 'unavailable',
            owners: [],
            token: crypto.randomUUID(),
        };
        return;
    }
    const clipIds = [...new Set([clipId, ...openedClipIds])];
    if (projections.some((entry) => !clipIds.includes(entry.clipId))) {
        pianoRollSelectionRuntime.selection = {
            clipId,
            clipIds,
            viewIds: [...viewIds],
            status: 'unavailable',
            owners: [],
            token: crypto.randomUUID(),
        };
        return;
    }
    const resolved = resolveOwners(viewIds, projections);
    pianoRollSelectionRuntime.selection = {
        clipId,
        clipIds,
        viewIds: [...viewIds],
        ...resolved,
        token: crypto.randomUUID(),
    };
}
