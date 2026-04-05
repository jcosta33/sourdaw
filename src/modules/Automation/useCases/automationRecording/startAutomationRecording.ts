import { getAllTracks } from '#/modules/Arrangement/useCases/getAllTracks';
import { automationStore } from '#/modules/Automation/stores/automationStore';
import {
    RECORDING_MODES,
    activeRecording,
    pendingPoints,
    touchActive,
    makeKey,
} from '#/modules/Automation/stores/automationRecordingState';

export function startAutomationRecording(): void {
    activeRecording.clear();
    pendingPoints.clear();
    touchActive.clear();

    const tracks = getAllTracks();

    const autoState = automationStore.value;
    if (!autoState) {
        return;
    }

    for (const track of tracks) {
        if (!RECORDING_MODES.has(track.automationMode)) {
            continue;
        }

        for (const lane of autoState.lanes) {
            if (lane.trackId !== track.id) {
                continue;
            }

            const key = makeKey(track.id, lane.parameterId);
            activeRecording.set(key, {
                parameterId: lane.parameterId,
                trackId: track.id,
                startBeat: 0,
                lastValue: null,
            });
            pendingPoints.set(key, []);
        }
    }
}
