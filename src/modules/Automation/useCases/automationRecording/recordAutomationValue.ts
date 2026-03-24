import { getTrackById } from '#/modules/Arrangement/useCases/trackQueries';
import { type AutomationPoint } from '#/modules/Automation/models/Automation';
import {
    RECORDING_MODES,
    activeRecording,
    pendingPoints,
    touchActive,
    makeKey,
    findLaneId,
    clearPointsInRange,
} from '#/modules/Automation/stores/automationRecordingState';

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

    if (track.automationMode === 'write') {
        if (laneId) {
            clearPointsInRange(laneId, session.startBeat, beat);
        }
        const points = pendingPoints.get(key) ?? [];
        points.push(point);
        pendingPoints.set(key, points);
        session.lastValue = value;
        session.startBeat = beat;
    } else if (track.automationMode === 'touch' || track.automationMode === 'latch') {
        touchActive.add(key);
        const points = pendingPoints.get(key) ?? [];
        points.push(point);
        pendingPoints.set(key, points);
        session.lastValue = value;
    }
}
