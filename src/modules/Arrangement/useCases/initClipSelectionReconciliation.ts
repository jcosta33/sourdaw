import { showsVariationLanes } from '../models/TimelineTrackExtent';
import { type Track } from '../models/Track';
import { clipSelectionStore } from '../stores/clipSelectionStore';
import { trackStore, type TrackStoreState } from '../stores/trackStore';

import { resolvePrimaryClip } from './clipSelection/resolvePrimaryClip';

// Inactive alternatives' clips are drawn and clickable only while the track shows its variation
// lanes. The active alternative's stored copy is refreshed only on a switch, so its clips are read
// from the track itself.
function collectLaneClipIds(track: Track): string[] {
    if (!showsVariationLanes(track)) {
        return [];
    }
    return track.alternatives
        .filter((alternative) => alternative.id !== track.activeAlternativeId)
        .flatMap((alternative) => alternative.clips.map((clip) => clip.id));
}

function collectExistingClipIds(state: TrackStoreState | null): Set<string> {
    const ids = new Set<string>();
    for (const track of state?.tracks ?? []) {
        for (const clip of track.clips) {
            ids.add(clip.id);
        }
        for (const laneClipId of collectLaneClipIds(track)) {
            ids.add(laneClipId);
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
