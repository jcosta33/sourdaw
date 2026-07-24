import { simplifyAutomationPoints } from '../../services/automationPointAlgorithms';
import { batchAddAutomationPoints } from '../automation/batchAddAutomationPoints';

import { findLaneId } from './findLaneId';
import { activeRecording, pendingPoints } from './recordingSessionState';

/**
 * Douglas–Peucker tolerance applied to a recorded gesture on flush. Interior
 * points whose deviation from the retained polyline stays under this collapse
 * away, so a full-rate fader/MIDI ride does not persist raw into project truth
 * (and the undo entry / CRDT history). Matches the manual `thinAutomationPoints`
 * default so record-flush and explicit thinning decimate consistently. Endpoints
 * are always retained exactly — RDP never moves the first or last point.
 */
const RECORD_FLUSH_THINNING_TOLERANCE = 0.01;

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

    const thinned = simplifyAutomationPoints({ points, tolerance: RECORD_FLUSH_THINNING_TOLERANCE });
    batchAddAutomationPoints(laneId, thinned);
    pendingPoints.set(key, []);
}
