import { updateTrack } from '#/modules/Arrangement/repositories/track/updateTrack';

export function toggleChordTrackFollow(trackId: string): void {
    updateTrack(trackId, (track) => ({
        ...track,
        followChordTrack: !track.followChordTrack,
    }));
}
