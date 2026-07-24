import { batchAddAutomationPoints } from '../automation/batchAddAutomationPoints';
import { simplifyGesturePoints } from '../automation/simplifyGesturePoints';

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

    // Thin the recorded gesture on flush with the single shared RDP so a
    // full-rate fader/MIDI ride does not persist raw into project truth, the
    // undo entry, and CRDT history. Endpoints preserved exactly; shape unchanged
    // (count only).
    const thinned = simplifyGesturePoints(points);
    batchAddAutomationPoints(laneId, thinned);
    pendingPoints.set(key, []);
}
