import { trackStore } from '#/modules/Arrangement/stores';
import { getAutomationRecordingDependencies } from './recordingDependencies';
import { transportStore } from '#/modules/Transport/stores';

import { type AutomationPoint } from '../../models/Automation';

import {
    RECORDING_MODES,
    activeRecording,
    pendingPoints,
    touchActive,
    makeKey,
    findLaneId,
    clearPointsInRange,
} from './recordingSessionState';

export function recordAutomationValue(trackId: string, parameterId: string, value: number, beat: number): void {
    const track = trackStore.value?.tracks.find((candidate) => candidate.id === trackId);
    if (!track || !RECORDING_MODES.has(track.automationMode)) {
        return;
    }

    const transport = transportStore.value;
    const tempo = transport?.tempo ?? 120;

    const deps = getAutomationRecordingDependencies();
    const ctx = deps.getAudioContext();
    const totalHardwareLatencySec = (ctx.baseLatency || 0) + (ctx.outputLatency || 0);
    const trackLatencySec = deps.getCompensationDelay(trackId);
    const totalLatencySec = totalHardwareLatencySec + trackLatencySec;
    const offsetBeats = (totalLatencySec * tempo) / 60;

    const compensatedBeat = Math.max(0, beat - offsetBeats);

    const key = makeKey(trackId, parameterId);
    let session = activeRecording.get(key);

    if (!session) {
        session = {
            parameterId,
            trackId,
            startBeat: compensatedBeat,
            lastValue: null,
        };
        activeRecording.set(key, session);
        pendingPoints.set(key, []);
    }

    const point: AutomationPoint = { beat: compensatedBeat, value, curve: 'linear', tension: 0 };
    const laneId = findLaneId(trackId, parameterId);

    // The session-creation branch above always calls `pendingPoints.set(key, [])`
    // so the entry exists here — push in place rather than allocating a
    // throwaway `[]` and re-setting (§106.2).
    const points = pendingPoints.get(key);

    if (track.automationMode === 'write') {
        if (laneId) {
            // Clear from recording start to current position (not shifting start)
            clearPointsInRange(laneId, session.startBeat, compensatedBeat);
        }
        points?.push(point);
        session.lastValue = value;
    } else if (track.automationMode === 'touch' || track.automationMode === 'latch') {
        touchActive.add(key);
        points?.push(point);
        session.lastValue = value;
    }
}
