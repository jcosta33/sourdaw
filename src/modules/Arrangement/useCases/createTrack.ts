import { createTrack as modelCreateTrack } from '../models/Track';
import { type Track, type TrackKind } from '../stores/trackStore';

type CreateTrackInput = { id?: string; name: string; kind: TrackKind; parentId?: string };

export function createTrack(input: CreateTrackInput): Track {
    return modelCreateTrack(input) as Track;
}
