import { stopRecording } from '#/modules/Arrangement/useCases';
import { stopAudioRecording } from '#/modules/AudioEngine/useCases';

import { updateTransportState } from '../../repositories/transport/updateTransportState';

/**
 * Shared recording-stop helper. Extracted from `toggleRecording` so that
 * `stopPlayback` can commit an active recording without statically importing
 * `toggleRecording` (which imports `startPlayback`, which imports the
 * scheduler — the full intra-Transport cycle closed via that path).
 */

let countInTimerId: ReturnType<typeof setTimeout> | null = null;

export function setCountInTimerId(id: ReturnType<typeof setTimeout> | null): void {
    countInTimerId = id;
}

export function stopActiveRecording(): void {
    stopAudioRecording();
    stopRecording();
    if (countInTimerId !== null) {
        clearTimeout(countInTimerId);
        countInTimerId = null;
    }
    updateTransportState({ isRecording: false });
}
