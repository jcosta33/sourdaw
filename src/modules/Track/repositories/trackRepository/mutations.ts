import { trackStore } from '../../stores/trackStore';
import { type Track, type Clip } from '../../models/Track';
import { type TrackState } from './queries';

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
