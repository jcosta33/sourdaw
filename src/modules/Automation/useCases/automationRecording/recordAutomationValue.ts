import { getTrackById } from '#/modules/Arrangement/useCases';
import { type AutomationPoint } from '../../models/Automation';
import {
    RECORDING_MODES,
    activeRecording,
    pendingPoints,
    touchActive,
    makeKey,
    findLaneId,
    clearPointsInRange,
} from '../../stores/automationRecordingState';

export function recordAutomationValue(trackId: string, parameterId: string, value: number, beat: number): void {
    const track = getTrackById(trackId);
    if (!track || !RECORDING_MODES.has(track.automationMode)) {
        return;
    }

    const key = makeKey(trackId, parameterId);
    let session = activeRecording.get(key);

    if (!session) {
        session = {
            parameterId,
            trackId,
            startBeat: beat,
            lastValue: null,
        };
        activeRecording.set(key, session);
        pendingPoints.set(key, []);
    }

    const point: AutomationPoint = { beat, value, curve: 'linear', tension: 0 };
    const laneId = findLaneId(trackId, parameterId);

    // The session-creation branch above always calls `pendingPoints.set(key, [])`
    // so the entry exists here — push in place rather than allocating a
    // throwaway `[]` and re-setting (§106.2).
    const points = pendingPoints.get(key);

    if (track.automationMode === 'write') {
        if (laneId) {
            // Clear from recording start to current position (not shifting start)
            clearPointsInRange(laneId, session.startBeat, beat);
        }
        points?.push(point);
        session.lastValue = value;
    } else if (track.automationMode === 'touch' || track.automationMode === 'latch') {
        touchActive.add(key);
        points?.push(point);
        session.lastValue = value;
    }
}
