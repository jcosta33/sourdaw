import { type Track } from '../models/Track';
import { timelineEditingStore } from '../stores/timelineEditingStore';
import { trackStore } from '../stores/trackStore';

import { getTracksShownInViews } from './getTracksShownInViews';
import { selectTrack } from './toggleTrackState/selectTrack';

function pickNearestShownTrackId(
    tracks: readonly Track[],
    selectedIndex: number,
    shownIds: ReadonlySet<string>
): string | null {
    const candidates = tracks.filter((track) => track.kind !== 'master' && shownIds.has(track.id));
    const next = candidates.find((track) => tracks.indexOf(track) > selectedIndex);
    if (next) {
        return next.id;
    }
    return candidates.at(-1)?.id ?? null;
}

function reconcileTrackSelection(): void {
    const state = trackStore.value;
    const selectedTrackId = state?.selectedTrackId ?? null;
    if (!state || selectedTrackId === null) {
        return;
    }
    const selectedIndex = state.tracks.findIndex((track) => track.id === selectedTrackId);
    if (selectedIndex < 0) {
        return;
    }
    const showHiddenTracks = timelineEditingStore.value?.showHiddenTracks ?? false;
    const shownIds = new Set(getTracksShownInViews(state.tracks, showHiddenTracks).map((track) => track.id));
    if (shownIds.has(selectedTrackId)) {
        return;
    }
    selectTrack(pickNearestShownTrackId(state.tracks, selectedIndex, shownIds));
}

/**
 * Keeps the track selection on a track the views show. Hiding a track (or a
 * folder above it) never touches the selection, so every reader of
 * `selectedTrackId` (paste, commands, browsers, AI context) would act on a row
 * the user cannot see. The selection moves to the next shown track, else the
 * previous one, else none. It writes through `selectTrack`, which records no
 * history, and never touches `Track.hidden`.
 */
export function initTrackSelectionVisibility(): () => void {
    const stopTracks = trackStore.subscribe(reconcileTrackSelection);
    const stopEditing = timelineEditingStore.subscribe(reconcileTrackSelection);
    return () => {
        stopTracks();
        stopEditing();
    };
}
