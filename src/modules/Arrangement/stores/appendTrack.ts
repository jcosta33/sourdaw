import { type Track, trackStore } from './trackStore';

/**
 * Append a pre-built track to the store and select it. Owned by Arrangement,
 * colocated with `trackStore` so cross-module creators (GrandBoule's
 * one-step "create track with bundled device") can commit the write without
 * importing `Arrangement/useCases` — which would transitively re-form
 * cross-module barrel cycles.
 *
 * Callers that only need the stock "create empty track of kind X" flow
 * should prefer `addTrack` from `Arrangement/useCases` instead: it emits the
 * `track.added` event and runs the full orchestration.
 */
export function appendTrack(track: Track): void {
    const state = trackStore.value;
    if (!state) {
        return;
    }
    trackStore.set({
        ...state,
        tracks: [...state.tracks, track],
        selectedTrackId: track.id,
    });
}
