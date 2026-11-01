import { clipSelectionStore } from '../stores/clipSelectionStore';
import { trackStore, type TrackStoreState } from '../stores/trackStore';

import { resolvePrimaryClip } from './clipSelection/resolvePrimaryClip';

function collectExistingClipIds(state: TrackStoreState | null): Set<string> {
    const ids = new Set<string>();
    for (const track of state?.tracks ?? []) {
        for (const clip of track.clips) {
            ids.add(clip.id);
        }
        // Inactive alternatives' clips are drawn and clickable in their variation lanes. The
        // active alternative's stored copy is only refreshed on a switch, so its clips are read
        // from the track itself above.
        for (const alternative of track.alternatives) {
            if (alternative.id === track.activeAlternativeId) {
                continue;
            }
            for (const clip of alternative.clips) {
                ids.add(clip.id);
            }
        }
    }
    // Ghost clips are selectable (Alt+] cycles through them) but live beside the tracks.
    for (const ghost of state?.ghostClips ?? []) {
        ids.add(ghost.id);
    }
    return ids;
}

function reconcileClipSelection(): void {
    const selection = clipSelectionStore.value;
    if (!selection) {
        return;
    }
    const { selectedClipId, selectedClipIds } = selection;
    if (selectedClipId === null && selectedClipIds.length === 0) {
        return;
    }
    const existing = collectExistingClipIds(trackStore.value);
    const hasMissingId = selectedClipId !== null && !existing.has(selectedClipId);
    if (!hasMissingId && selectedClipIds.every((id) => existing.has(id))) {
        return;
    }
    const survivors = selectedClipIds.filter((id) => existing.has(id));
    clipSelectionStore.set({
        ...selection,
        selectedClipIds: survivors,
        selectedClipId: resolvePrimaryClip(survivors, selectedClipId),
    });
}

/**
 * Keeps the clip selection to clips that still exist. A clip leaves the project
 * by many routes that never touch the selection (undoing a paste, a
 * collaborator's delete, deleting a track, loading another project, an AI action),
 * so reconciling here, on the one store every route writes, covers them all and
 * any route added later. The marquee is a time range, not a clip list, and is
 * left alone.
 */
export function initClipSelectionReconciliation(): () => void {
    return trackStore.subscribe(reconcileClipSelection);
}
