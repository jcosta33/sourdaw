import { type AutomationPoint } from '../../models/Automation';

import {
    activeRecording,
    laneBaselines,
    pendingOwners,
    pendingPoints,
    touchActive,
    type RecordingSession,
} from './recordingSessionState';

function cloneSessions(source: ReadonlyMap<string, RecordingSession>): Map<string, RecordingSession> {
    return new Map([...source].map(([key, session]) => [key, { ...session }]));
}

function clonePointMap(source: ReadonlyMap<string, AutomationPoint[]>): Map<string, AutomationPoint[]> {
    return new Map([...source].map(([key, points]) => [key, points.map((point) => ({ ...point }))]));
}

function cloneOwnerMap(source: ReadonlyMap<string, Array<symbol | undefined>>): Map<string, Array<symbol | undefined>> {
    return new Map([...source].map(([key, owners]) => [key, [...owners]]));
}

function restoreMap<Value>(target: Map<string, Value>, snapshot: ReadonlyMap<string, Value>): void {
    target.clear();
    for (const [key, value] of snapshot) {
        target.set(key, value);
    }
}

export function captureAutomationRecordingRollback(): () => void {
    const activeSnapshot = cloneSessions(activeRecording);
    const pendingSnapshot = clonePointMap(pendingPoints);
    const ownerSnapshot = cloneOwnerMap(pendingOwners);
    const baselineSnapshot = clonePointMap(laneBaselines);
    const touchSnapshot = new Set(touchActive);

    return () => {
        restoreMap(activeRecording, cloneSessions(activeSnapshot));
        restoreMap(pendingPoints, clonePointMap(pendingSnapshot));
        restoreMap(pendingOwners, cloneOwnerMap(ownerSnapshot));
        restoreMap(laneBaselines, clonePointMap(baselineSnapshot));
        touchActive.clear();
        for (const key of touchSnapshot) {
            touchActive.add(key);
        }
    };
}
