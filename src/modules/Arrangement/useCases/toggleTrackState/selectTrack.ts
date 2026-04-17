import { updateTrackState } from '../../repositories/track/updateTrackState';
import { getTrackById } from '../../repositories/track/getTrackById';
import { setMidiInputTrack } from '#/modules/AudioEngine/useCases';
import { trackStore } from '../../stores/trackStore';
import { eventBus } from '#/app/registerDependencies';

export function selectTrack(trackId: string | null): void {
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
        eventBus.emit('track.selectionChanged', { trackId, previousTrackId });
    }
}
