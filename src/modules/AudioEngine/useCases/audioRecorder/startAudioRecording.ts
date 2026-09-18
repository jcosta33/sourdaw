import { trackStore } from '#/modules/Arrangement/stores';

import { startAudioRecording as startAudioRecordingRepo } from '../../repositories/audioRecorder/recording';
import { getSelectedInputId } from '../audioDeviceSelection/getSelectedInputId';
import { startInputMonitoring } from '../audioRecorder/startInputMonitoring';
import { stopTrackInputMonitoring } from '../audioRecorder/stopTrackInputMonitoring';

export async function startAudioRecording(
    trackId: string,
    onTerminal: Parameters<typeof startAudioRecordingRepo>[1],
    inputId?: string | null
): Promise<boolean> {
    const selectedInputId = inputId === undefined ? getSelectedInputId() : inputId;
    const admitted = await startAudioRecordingRepo(trackId, onTerminal, selectedInputId);
    if (!admitted) {
        return false;
    }
    engageModeListeningPath(trackId, selectedInputId);
    return true;
}

/**
 * The recording session captures silently: it never feeds the strip itself.
 * The monitor repository alone owns listening edges, so the take hears exactly
 * one intentional path — the musician's own monitor edge when it exists, one
 * opened here for On/Auto otherwise. Off tears any stray edge down so software
 * monitoring stays suppressed while capture continues. The mode is read after
 * admission so a flip made while the microphone grant was pending wins.
 */
function engageModeListeningPath(trackId: string, inputId: string | null): void {
    const track = trackStore.value?.tracks.find((candidate) => candidate.id === trackId);
    if (track?.inputMonitoring === 'on' || track?.inputMonitoring === 'auto') {
        void startInputMonitoring(trackId, inputId);
        return;
    }
    stopTrackInputMonitoring(trackId);
}
