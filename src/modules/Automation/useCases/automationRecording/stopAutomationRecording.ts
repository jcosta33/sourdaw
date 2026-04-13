import { getAllTracks } from '#/modules/Arrangement/useCases';
import {
    activeRecording,
    pendingPoints,
    touchActive,
    findLaneId,
    clearPointsInRange,
    flushPendingPoints,
} from './recordingSessionState';

export function stopAutomationRecording(): void {
    const tracks = getAllTracks();

    for (const [key, session] of activeRecording) {
        const track = tracks.find((t) => t.id === session.trackId);

        if (track?.automationMode === 'latch' && session.lastValue !== null) {
            const points = pendingPoints.get(key) ?? [];
            const lastBeat = points.length > 0 ? points[points.length - 1]!.beat : session.startBeat;
            const laneId = findLaneId(session.trackId, session.parameterId);

            if (laneId && lastBeat > session.startBeat) {
                clearPointsInRange(laneId, session.startBeat, lastBeat);
            }
        }

        flushPendingPoints(key);
    }

    activeRecording.clear();
    pendingPoints.clear();
    touchActive.clear();
}
