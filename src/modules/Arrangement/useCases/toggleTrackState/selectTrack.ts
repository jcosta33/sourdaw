import { inject } from '#/infra/di/inject';
import { setMidiInputTrack } from '#/modules/MIDI/useCases';

import { getTrackById } from '../../repositories/track/getTrackById';
import { updateTrackState } from '../../repositories/track/updateTrackState';
import { trackStore } from '../../stores/trackStore';
import { ArrangementEventBus } from '../arrangementEventBus';

export const selectTrack = inject({ eventBus: ArrangementEventBus })(
    ({ eventBus }) =>
        function selectTrack(trackId: string | null): void {
            // Subscribers receive `previousTrackId` so they can distinguish a real
            // selection change from a re-click on the already-selected track (e.g.
            // device panels only tear down when the selection actually moves).
            const previousTrackId = trackStore.value?.selectedTrackId ?? null;

            updateTrackState({ selectedTrackId: trackId });

            if (trackId) {
                const track = getTrackById(trackId);
                if (track && track.kind === 'midi') {
                    setMidiInputTrack(trackId);
                }
            }

            if (previousTrackId !== trackId) {
                void eventBus.emit('track.selectionChanged', { trackId, previousTrackId });
            }
        }
);
