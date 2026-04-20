/**
 * Create a Grand Boule piano track.
 *
 * Creates a MIDI track with the Grand Boule device attached and wires it
 * into the audio engine strip.
 */

import { eventBus } from '#/app/registerDependencies';
import { inject } from '#/infra/di/inject';
import { createTrack, getTrackStoreState, setTrackStoreState } from '#/modules/Arrangement/useCases';
import { addDeviceToStrip } from '#/modules/AudioEngine/useCases';

export const createGrandBouleTrack = inject({ eventBus })(
    ({ eventBus }) =>
        function createGrandBouleTrack(): string | null {
            const state = getTrackStoreState();
            if (state === null) {
                return null;
            }

            const track = createTrack({ name: 'Grand Boule', kind: 'midi' });
            const deviceId = `grand-boule-${crypto.randomUUID().slice(0, 8)}`;
            track.devices = [
                {
                    id: deviceId,
                    name: 'Grand Boule',
                    type: 'grand-boule',
                    bypassed: false,
                    parameterValues: {},
                },
            ];

            setTrackStoreState({
                ...state,
                tracks: [...state.tracks, track],
                selectedTrackId: track.id,
            });

            addDeviceToStrip(track.id, deviceId, 'grand-boule');

            void eventBus.emit('track.added', { trackId: track.id, name: track.name, kind: track.kind });

            return track.id;
        }
);
