import { updateTrack, getTrackById } from '#/modules/Arrangement/repositories/track';
import { startInputMonitoring, stopInputMonitoring } from '#/modules/AudioEngine/useCases/audioRecorder';

export function toggleInputMonitoring(trackId: string): void {
    const track = getTrackById(trackId);
    if (!track) {
        return;
    }
    const newValue = track.inputMonitoring === 'on' ? 'off' : 'on';
    updateTrack(trackId, (t) => ({ ...t, inputMonitoring: newValue }));

    if (newValue === 'on') {
        void startInputMonitoring(trackId);
    } else {
        stopInputMonitoring();
    }
}
