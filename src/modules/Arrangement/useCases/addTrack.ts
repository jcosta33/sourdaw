import { createTrack, type Track, type TrackKind } from '../models/Track';
import { getTrackState } from '../repositories/track/getTrackState';
import { setTrackState } from '../repositories/track/setTrackState';
import { eventBus } from '#/app/bootstrap';
import { TrackAddedEvent } from '../events/TrackAddedEvent';

type AddTrackInput = { id?: string; name: string; kind: TrackKind };

export function addTrack(input: AddTrackInput): Track | null {
    const state = getTrackState();
    if (!state) {
        return null;
    }

    const track = createTrack(input);
    setTrackState({
        ...state,
        tracks: [...state.tracks, track],
        selectedTrackId: track.id,
    });

    eventBus.emit(new TrackAddedEvent({ trackId: track.id, name: track.name, kind: track.kind }));
    return track;
}
