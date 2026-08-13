import { createTrack as modelCreateTrack, type Track, type TrackKind } from '../models/Track';

type CreateTrackInput = {
    id?: string;
    initialAlternativeId?: string;
    initialDeviceId?: string;
    name: string;
    kind: TrackKind;
    parentId?: string;
};

export function createTrack(input: CreateTrackInput): Track {
    return modelCreateTrack(input);
}
