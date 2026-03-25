import { createTrack, type Track, type TrackKind } from '../models/Track';
import { getTrackState, setTrackState } from '../repositories/track';
import { eventBus } from '#/app/bootstrap';
import { TrackAddedEvent } from '../events/TrackAddedEvent';

type AddTrackInput = { name: string; kind: TrackKind };

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
