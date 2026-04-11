import { inject } from '#/infra/di/inject';
import { punchRecordingStore, type BackgroundCapture } from '#/modules/Transport/stores/punchRecordingStore';
import { getNextCaptureId } from '../../repositories/punchRecordingIdCounter';

export const startBackgroundCapture = inject({ punchRecordingStore, getNextCaptureId })(
    ({ punchRecordingStore: store, getNextCaptureId: nextId }) => {
        return function startBackgroundCapture(trackId: string, startBeat: number): void {
            const state = store.value;
            if (!state || !state.enabled) {
                return;
            }

            const capture: BackgroundCapture = {
                id: nextId(),
                trackId,
                startBeat,
                endBeat: startBeat,
                recording: true,
                punchRegions: [],
            };

            store.set({
                ...state,
                captures: [...state.captures, capture],
            });
        };
    }
);
