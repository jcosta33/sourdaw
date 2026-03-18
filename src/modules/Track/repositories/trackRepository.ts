/**
 * Track Repository — mediates all Track store access.
 *
 * Use cases import this repository instead of touching trackStore directly.
 * This keeps the dependency flow: useCases → repositories → stores.
 */

import { trackStore } from '../stores/trackStore';
import { type Track, type Clip } from '../models/Track';

export type TrackState = {
    tracks: Track[];
    selectedTrackId: string | null;
};

/** Read the current track state snapshot. */
export function getTrackState(): TrackState | null {
    return trackStore.value;
}

/** Get all tracks. Returns empty array if store is not initialised. */
export function getAllTracks(): Track[] {
    return trackStore.value?.tracks ?? [];
}

/** Find a single track by id. */
export function getTrackById(trackId: string): Track | undefined {
    return trackStore.value?.tracks.find((t) => t.id === trackId);
}

/** Replace the full track state. */
export function setTrackState(state: TrackState): void {
    trackStore.set(state);
}

/** Partial update of the track state (merges with current). */
export function updateTrackState(patch: Partial<TrackState>): void {
    const state = trackStore.value;
    if (!state) {
        return;
    }
    trackStore.set({ ...state, ...patch });
}

/** Update a single track (immutable update, replaces by id). */
export function updateTrack(trackId: string, updater: (track: Track) => Track): void {
    const state = trackStore.value;
    if (!state) {
        return;
    }
    trackStore.set({
        ...state,
        tracks: state.tracks.map((t) => (t.id === trackId ? updater(t) : t)),
    });
}

/** Update all tracks with a mapper function. */
export function mapAllTracks(mapper: (track: Track) => Track): void {
    const state = trackStore.value;
    if (!state) {
        return;
    }
    trackStore.set({
        ...state,
        tracks: state.tracks.map(mapper),
    });
}

/** Update multiple tracks matching a predicate. */
export function updateTracks(predicate: (track: Track) => boolean, updater: (track: Track) => Track): void {
    const state = trackStore.value;
    if (!state) {
        return;
    }
    trackStore.set({
        ...state,
        tracks: state.tracks.map((t) => (predicate(t) ? updater(t) : t)),
    });
}

/** Update a single clip by id across all tracks. */
export function updateClip(clipId: string, updater: (clip: Clip) => Clip): void {
    const state = trackStore.value;
    if (!state) {
        return;
    }
    trackStore.set({
        ...state,
        tracks: state.tracks.map((t) => ({
            ...t,
            clips: t.clips.map((c) => (c.id === clipId ? updater(c) : c)),
        })),
    });
}

/** Update clips on all tracks with a mapper function. */
export function updateClipsOnAllTracks(mapper: (clip: Clip) => Clip): void {
    const state = trackStore.value;
    if (!state) {
        return;
    }
    trackStore.set({
        ...state,
        tracks: state.tracks.map((t) => ({
            ...t,
            clips: t.clips.map(mapper),
        })),
    });
}
