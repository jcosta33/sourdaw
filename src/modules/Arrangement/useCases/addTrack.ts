import { inject } from '#/infra/di/inject';

import { createTrack as createTrackModel } from '../models/Track';
import { getTrackState } from '../repositories/track/getTrackState';
import { setTrackState } from '../repositories/track/setTrackState';
import { type Track, type TrackKind } from '../stores/trackStore';
import { ArrangementEventBus } from './arrangementEventBus';

type AddTrackInput = { id?: string; name: string; kind: TrackKind };

export const addTrack = inject({ eventBus: ArrangementEventBus })(
    ({ eventBus }) =>
        function addTrack(input: AddTrackInput): Track | null {
            const state = getTrackState();
            if (!state) {
                return null;
            }

            const track = createTrackModel(input);
            setTrackState({
                ...state,
                tracks: [...state.tracks, track],
                selectedTrackId: track.id,
            });

            void eventBus.emit('track.added', { trackId: track.id, name: track.name, kind: track.kind });
            return track;
        }
);
