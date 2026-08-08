import { batchAddAutomationPoints } from '../automation/batchAddAutomationPoints';
import { simplifyGesturePoints } from '../automation/simplifyGesturePoints';

import { captureLaneBaseline } from './captureLaneBaseline';
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

    // A touch release flushes here, mid-session. Take the lane's pre-session
    // baseline before the write lands, or the undo entry built at stop has
    // nothing to diff against and the whole released pass goes unrecorded.
    captureLaneBaseline(laneId);

    // Thin the recorded gesture on flush with the single shared RDP so a
    // full-rate fader/MIDI ride does not persist raw into project truth, the
    // undo entry, and CRDT history. Endpoints preserved exactly; shape unchanged
    // (count only).
    const thinned = simplifyGesturePoints(points);
    batchAddAutomationPoints(laneId, thinned);
    pendingPoints.set(key, []);
}
