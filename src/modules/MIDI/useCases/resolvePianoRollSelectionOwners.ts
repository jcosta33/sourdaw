import { type Owner, type PianoRollSelection, type Projection } from './pianoRollSelectionRuntime';

export function resolvePianoRollSelectionOwners(
    viewIds: readonly string[],
    projections: readonly Projection[]
): Pick<PianoRollSelection, 'status' | 'owners'> {
    if (viewIds.length > 512 || projections.length > 256) {
        return { status: 'unavailable', owners: [] };
    }
    const size = projections.reduce(
        (count, entry) => count + entry.projection.notes.length + entry.projection.baseNotes.length,
        0
    );
    if (size > 16_384) {
        return { status: 'unavailable', owners: [] };
    }
    const wanted = new Set(viewIds);
    const owners = new Map<string, Owner>();
    for (const { clipId, projection } of projections) {
        for (const note of [...projection.baseNotes, ...projection.notes]) {
            if (!wanted.has(note.id)) {
                continue;
            }
            if (owners.has(note.id)) {
                return { status: 'ambiguous', owners: [] };
            }
            const frozen = projection.ownersByViewId.get(note.id);
            const base = projection.baseOwnersByViewId.get(note.id);
            const owner: Owner = {
                clipId,
                viewId: note.id,
                ownerClipId: frozen?.sourceClipId ?? clipId,
                storedNoteId: frozen?.row.id ?? base?.row.id ?? note.id,
                displayedStartBeat: note.startBeat,
                displayedDuration: note.duration,
            };
            if (frozen) {
                owner.takeId = frozen.takeId;
                owner.occurrenceIndex = frozen.occurrenceIndex;
            }
            owners.set(note.id, owner);
        }
    }
    if (owners.size !== wanted.size) {
        return { status: 'unavailable', owners: [] };
    }
    return { status: 'resolved', owners: [...owners.values()] };
}
