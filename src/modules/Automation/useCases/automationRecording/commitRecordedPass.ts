import { captureLaneBaseline } from './captureLaneBaseline';
import { clearPointsInRange } from './clearPointsInRange';
import { findLaneId } from './findLaneId';
import { flushPendingPoints } from './flushPendingPoints';
import { activeRecording, pendingPoints } from './recordingSessionState';

/**
 * Land one recorded pass into its lane and empty the buffer behind it.
 *
 * A "pass" is one sweep of the playhead across the recorded span. Transport stop
 * ends a pass, and so does a loop wrap — which is why this is a function rather
 * than inline in `stopAutomationRecording`. Both callers need the same three
 * steps in the same order: baseline the lane before the session's first write to
 * it, clear the span the pass overwrites (write and latch replace what they pass
 * over; touch does not), then flush the buffered points through the shared RDP.
 *
 * The clear happens once per pass rather than once per recorded value — the old
 * per-value `clearPointsInRange` ran a full lane re-map at roughly 100 Hz.
 */
export function commitRecordedPass(key: string, overwrites: boolean): void {
    const session = activeRecording.get(key);
    if (!session) {
        return;
    }

    const laneId = findLaneId(session.trackId, session.parameterId);
    if (laneId) {
        // Write mode buffers everything until the pass ends, so its lanes reach
        // here with no baseline yet. First capture wins, so a lane already
        // baselined by an earlier release or pass keeps its true pre-session state.
        captureLaneBaseline(laneId);
    }

    const points = pendingPoints.get(key);
    const lastBeat = points && points.length > 0 ? points[points.length - 1]!.beat : session.startBeat;

    if (overwrites && laneId && session.lastValue !== null && lastBeat > session.startBeat) {
        clearPointsInRange(laneId, session.startBeat, lastBeat);
    }

    flushPendingPoints(key);
}
