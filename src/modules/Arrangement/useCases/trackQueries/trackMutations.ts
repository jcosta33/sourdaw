/**
 * Track mutation use cases — public contract wrappers over repositories.
 *
 * Cross-module consumers MUST use these instead of importing from repositories directly.
 */

import {
    setTrackState as repoSetTrackState,
    updateTrack as repoUpdateTrack,
    updateClip as repoUpdateClip,
    type TrackState,
} from '#/modules/Arrangement/repositories/track';
import { type Track, type Clip } from '#/modules/Arrangement/models/Track';

/** Replace the full track state. */
export function setTrackState(state: TrackState): void {
    repoSetTrackState(state);
}

/** Update a single track immutably (replaces by id). */
export function updateTrack(trackId: string, updater: (track: Track) => Track): void {
    repoUpdateTrack(trackId, updater);
}

/** Update a single clip by id across all tracks. */
export function updateClip(clipId: string, updater: (clip: Clip) => Clip): void {
    repoUpdateClip(clipId, updater);
}

export type { TrackState };
