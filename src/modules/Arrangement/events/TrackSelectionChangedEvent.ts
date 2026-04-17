/**
 * Emitted after `selectTrack` changes the selected track id in the store.
 *
 * `previousTrackId` is the value held by `trackStore.selectedTrackId` immediately
 * before the update; consumers use it to detect the "actually changed" case
 * (e.g. closing device panels only when the selection moves to a different track,
 * not when the same track is clicked twice).
 */
export type TrackSelectionChangedPayload = {
    trackId: string | null;
    previousTrackId: string | null;
};
