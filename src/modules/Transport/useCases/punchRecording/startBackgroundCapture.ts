import { punchRecordingStore, type BackgroundCapture } from '#/modules/Transport/stores/punchRecordingStore';
import { getNextCaptureId } from '../../repositories/punchRecordingIdCounter';

export function startBackgroundCapture(trackId: string, startBeat: number): void {
    const state = punchRecordingStore.value;
    if (!state || !state.enabled) {
        return;
    }

    const capture: BackgroundCapture = {
        id: getNextCaptureId(),
        trackId,
        startBeat,
        endBeat: startBeat,
        recording: true,
        punchRegions: [],
    };

    punchRecordingStore.set({
        ...state,
        captures: [...state.captures, capture],
    });
}
