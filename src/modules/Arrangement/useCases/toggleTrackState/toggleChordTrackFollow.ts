import { updateTrack } from '../trackQueries/trackMutations';

export function toggleChordTrackFollow(trackId: string): void {
    updateTrack(trackId, (track) => ({
        ...track,
        followChordTrack: !track.followChordTrack,
    }));
}
