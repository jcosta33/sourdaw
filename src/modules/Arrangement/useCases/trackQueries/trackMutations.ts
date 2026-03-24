/**
 * Track mutation use cases — public contract wrappers over repositories.
 *
 * Cross-module consumers MUST use these instead of importing from repositories directly.
 */

import {
    setTrackState as repoSetTrackState,
    updateTrack as repoUpdateTrack,
    updateClip as repoUpdateClip,
    updateClipsOnAllTracks as repoUpdateClipsOnAllTracks,
    mapAllTracks as repoMapAllTracks,
    type TrackState,
} from '#/modules/Arrangement/repositories/trackRepository';
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

/** Update clips on all tracks with a mapper function. */
export function updateClipsOnAllTracks(mapper: (clip: Clip) => Clip): void {
    repoUpdateClipsOnAllTracks(mapper);
}

/** Update all tracks with a mapper function. */
export function mapAllTracks(mapper: (track: Track) => Track): void {
    repoMapAllTracks(mapper);
}

export type { TrackState };
