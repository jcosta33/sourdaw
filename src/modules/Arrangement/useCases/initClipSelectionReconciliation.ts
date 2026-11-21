import { showsVariationLanes } from '../models/TimelineTrackExtent';
import { type Track } from '../models/Track';
import { clipSelectionStore } from '../stores/clipSelectionStore';
import { timelineEditingStore } from '../stores/timelineEditingStore';
import { trackStore, type TrackStoreState } from '../stores/trackStore';

import { resolvePrimaryClip } from './clipSelection/resolvePrimaryClip';
import { getTracksShownInViews } from './getTracksShownInViews';

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
    const showHiddenTracks = timelineEditingStore.value?.showHiddenTracks ?? false;
    for (const track of getTracksShownInViews(state?.tracks ?? [], showHiddenTracks)) {
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
 * Keeps the clip selection to existing clips on tracks the views show. A clip leaves the project
 * by many routes that never touch the selection (undoing a paste, a
 * collaborator's delete, deleting a track, loading another project, an AI action),
 * so reconciling here, on the one store every route writes, covers them all and
 * any route added later. The marquee is a time range, not a clip list, and is
 * left alone. A hidden track's clips (or those under a hidden folder) leave the
 * selection too, on a hide and when the show-hidden flag turns off, so copy, cut
 * and delete never act on clips the user cannot see. It also runs on every
 * selection write, so no selection route can hold a clip the views do not show.
 */
export function initClipSelectionReconciliation(): () => void {
    const stopTracks = trackStore.subscribe(reconcileClipSelection);
    const stopEditing = timelineEditingStore.subscribe(reconcileClipSelection);
    // Its own write re-enters here, finds every id kept and returns without writing.
    const stopSelection = clipSelectionStore.subscribe(reconcileClipSelection);
    return () => {
        stopTracks();
        stopEditing();
        stopSelection();
    };
}
