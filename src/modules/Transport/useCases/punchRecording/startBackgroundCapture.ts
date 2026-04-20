import { getNextCaptureId } from '../../repositories/punchRecordingIdCounter/getNextCaptureId';
import { punchRecordingStore, type BackgroundCapture } from '../../stores/punchRecordingStore';

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
