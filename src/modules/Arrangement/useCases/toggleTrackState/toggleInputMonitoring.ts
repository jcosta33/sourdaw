import { updateTrack } from '#/modules/Arrangement/repositories/track/updateTrack';
import { getTrackById } from '#/modules/Arrangement/repositories/track/getTrackById';
import { startInputMonitoring, stopInputMonitoring } from '#/modules/AudioEngine/useCases';

export function toggleInputMonitoring(trackId: string): void {
    const track = getTrackById(trackId);
    if (!track) {
        return;
    }
    const newValue = track.inputMonitoring === 'on' ? 'off' : 'on';
    updateTrack(trackId, (t) => ({ ...t, inputMonitoring: newValue }));

    if (newValue === 'on') {
        startInputMonitoring(trackId);
    } else {
        stopInputMonitoring();
    }
}
