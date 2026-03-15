import { trackStore } from "../stores/trackStore";
import { eventBus } from "#/app/bootstrap";
import { TrackRemovedEvent } from "../events/TrackRemovedEvent";

export const removeTrack = (trackId: string): void => {
    const state = trackStore.value;
    if (!state) return;

    const track = state.tracks.find((t) => t.id === trackId);
    if (!track) return;

    trackStore.set({
        ...state,
        tracks: state.tracks.filter((t) => t.id !== trackId),
        selectedTrackId: state.selectedTrackId === trackId ? null : state.selectedTrackId,
    });

    eventBus.emit(new TrackRemovedEvent({ trackId }));
};
