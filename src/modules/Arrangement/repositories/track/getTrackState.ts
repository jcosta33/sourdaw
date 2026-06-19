import { trackStore, type TrackStoreState } from '../../stores/trackStore';

/**
 * The full track-state snapshot — identical to the store shape, so repository
 * readers see every field the store carries (including `ghostClips`).
 *
 * Finding #43: this used to be a hand-rolled `{ tracks; selectedTrackId }`
 * type that omitted `ghostClips`. Readers going through this repository then
 * couldn't see ghost clips while direct `trackStore.value` readers (e.g.
 * buildTimelineRenderModel) could — two divergent views of the same store.
 */
export type TrackState = TrackStoreState;

/** Read the current track state snapshot. */
export function getTrackState(): TrackState | null {
    return trackStore.value;
}
