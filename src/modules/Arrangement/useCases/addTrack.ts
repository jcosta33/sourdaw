import { createTrack as createTrackModel } from '../models/Track';
import { getTrackState } from '../repositories/track/getTrackState';
import { setTrackState } from '../repositories/track/setTrackState';
import { type Track, type TrackKind } from '../stores/trackStore';

type AddTrackInput = {
    color?: string;
    gain?: number;
    id?: string;
    initialAlternativeId?: string;
    initialDeviceId?: string;
    name: string;
    kind: TrackKind;
    parentId?: string;
    outputId?: string;
    select?: boolean;
    withoutDefaultDevice?: boolean;
};

export function addTrack(input: AddTrackInput): Track | null {
    const state = getTrackState();
    if (!state) {
        return null;
    }

    const track = createTrackModel(input);
    setTrackState({
        ...state,
        tracks: [...state.tracks, track],
        selectedTrackId: input.select === false ? state.selectedTrackId : track.id,
    });

    return track;
}
