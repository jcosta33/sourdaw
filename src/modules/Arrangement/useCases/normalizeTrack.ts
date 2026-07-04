import { normalizeTrack as modelNormalizeTrack, type Track, type TrackKind } from '../models/Track';

type NormalizeTrackInput = Partial<Track> & { id: string; name: string; kind: TrackKind };

export function normalizeTrack(track: NormalizeTrackInput): Track {
    return modelNormalizeTrack(track);
}
