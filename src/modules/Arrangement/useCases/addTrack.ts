import { inject } from '#/infra/di/inject';
import { createTrack, type Track, type TrackKind } from '../models/Track';
import { getTrackState } from '../repositories/track/getTrackState';
import { setTrackState } from '../repositories/track/setTrackState';
import { eventBus } from '#/app/registerDependencies';

type AddTrackInput = { id?: string; name: string; kind: TrackKind };

export const addTrack = inject({ eventBus, getTrackState, setTrackState })(
    ({ eventBus, getTrackState, setTrackState }) =>
        function addTrack(input: AddTrackInput): Track | null {
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

            eventBus.emit('track.added', { trackId: track.id, name: track.name, kind: track.kind });
            return track;
        }
);
