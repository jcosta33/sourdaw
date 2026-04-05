import { updateTrack } from '../updateTrack';

export function toggleChordTrackFollow(trackId: string): void {
    updateTrack(trackId, (track) => ({
        ...track,
        followChordTrack: !track.followChordTrack,
    }));
}
