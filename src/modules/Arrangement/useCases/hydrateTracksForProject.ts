import { normalizeTrack, type Track, type TrackKind } from '../models/Track';
import { trackStore } from '../stores/trackStore';

type HydrateTracksForProjectInput = {
    tracks: readonly (Partial<Track> & { id: string; name: string; kind: TrackKind })[];
};

export function hydrateTracksForProject({ tracks }: HydrateTracksForProjectInput): void {
    trackStore.set({
        tracks: tracks.map(normalizeTrack),
        selectedTrackId: null,
    });
}
