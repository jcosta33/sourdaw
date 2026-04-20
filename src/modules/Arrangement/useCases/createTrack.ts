import {
    createTrack as modelCreateTrack,
    normalizeTrack as modelNormalizeTrack,
    type Track,
    type TrackKind,
} from '../models/Track';

type CreateTrackInput = { id?: string; name: string; kind: TrackKind; parentId?: string };

export function createTrack(input: CreateTrackInput): Track {
    return modelCreateTrack(input);
}

export function normalizeTrack(track: Partial<Track> & { id: string; name: string; kind: TrackKind }): Track {
    return modelNormalizeTrack(track);
}
