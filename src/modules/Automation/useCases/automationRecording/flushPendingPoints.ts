import { batchAddAutomationPoints } from '../automation/batchAddAutomationPoints';

import { findLaneId } from './findLaneId';
import { activeRecording, pendingPoints } from './recordingSessionState';

export function flushPendingPoints(key: string): void {
    const points = pendingPoints.get(key);
    const session = activeRecording.get(key);
    if (!points || points.length === 0 || !session) {
        return;
    }

    const laneId = findLaneId(session.trackId, session.parameterId);
    if (!laneId) {
        return;
    }

    batchAddAutomationPoints(laneId, points);
    pendingPoints.set(key, []);
}
