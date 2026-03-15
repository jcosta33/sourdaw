import { createTrack, type TrackKind } from "../models/Track";
import { trackStore } from "../stores/trackStore";
import { eventBus } from "#/app/bootstrap";
import { TrackAddedEvent } from "../events/TrackAddedEvent";

type AddTrackInput = { name: string; kind: TrackKind };

export const addTrack = (input: AddTrackInput): void => {
    const state = trackStore.value;
    if (!state) return;

    const track = createTrack(input);
    trackStore.set({
        ...state,
        tracks: [...state.tracks, track],
        selectedTrackId: track.id,
    });

    eventBus.emit(new TrackAddedEvent({ trackId: track.id, name: track.name, kind: track.kind }));
};
