import { captureLaneBaseline } from './captureLaneBaseline';
import { clearPointsInRange } from './clearPointsInRange';
import { findLaneId } from './findLaneId';
import { flushPendingPoints } from './flushPendingPoints';
import { latencyCompensatedBeat } from './latencyCompensatedBeat';
import { activeRecording, pendingPoints } from './recordingSessionState';

// Automation-local mode union (AGENTS.md §95 — model isolation). Mirrors
// Arrangement's AutomationMode; touch reaches this call too, and only the
// write/latch pair overwrites.
type PassMode = 'write' | 'latch' | 'touch';

/**
 * Land one recorded pass into its lane and empty the buffer behind it.
 *
 * A "pass" is one sweep of the playhead across the recorded span. Transport stop
 * ends a pass, and so does a loop wrap — which is why this is a function rather
 * than inline in `stopAutomationRecording`. Both callers need the same steps in
 * the same order: baseline the lane before the session's first write to it,
 * clear the span the pass overwrites (write and latch replace what they pass
 * over; touch does not), then flush the buffered points through the shared RDP.
 *
 * `boundaryRawBeat` is the beat the pass actually ended at, in raw transport
 * beats: the live cursor at the stop for a transport boundary, or the pass's
 * last known raw beat at a loop wrap. Write and latch *held* their last value
 * from the final gesture through that boundary — live playback suppressed the
 * lane the whole way (`applyAutomation` skips it while the session records), so
 * the user heard the held value, not the old curve. Committing only through the
 * last buffered gesture left the old points beyond it alive, and replay jumped
 * back onto a curve the pass had silenced (#3798). The boundary extends the
 * overwritten span and lands one held-value point at it, so replay equals what
 * was heard. `null` means no boundary is known and the pass commits through its
 * last gesture alone. Touch never holds: its release returns to the curve
 * through the AutoMatch glide, which keeps its own separate behavior.
 *
 * The clear happens once per pass rather than once per recorded value — the old
 * per-value `clearPointsInRange` ran a full lane re-map at roughly 100 Hz.
 */
export function commitRecordedPass(key: string, mode: PassMode, boundaryRawBeat: number | null): void {
    const session = activeRecording.get(key);
    if (!session) {
        return;
    }

    const overwrites = mode === 'write' || mode === 'latch';

    const laneId = findLaneId(session.trackId, session.parameterId);
    if (laneId) {
        // Write mode buffers everything until the pass ends, so its lanes reach
        // here with no baseline yet. First capture wins, so a lane already
        // baselined by an earlier release or pass keeps its true pre-session state.
        captureLaneBaseline(laneId);
    }

    // A session and its buffer are created together; the pair is kept whole so
    // the held point below can land in the buffer the flush empties.
    let points = pendingPoints.get(key);
    if (!points) {
        points = [];
        pendingPoints.set(key, points);
    }
    const lastGestureBeat = points.length > 0 ? points[points.length - 1]!.beat : null;

    // Where the overwrite begins. Latch honors the existing curve until its
    // *first touch* of this pass — the lane is suppressed only once a gesture
    // has landed, so the span before that beat was heard from the old curve and
    // must survive. The span start lives on the session, not on the buffer: a
    // mid-pass touch release flushes the buffer empty while the writing span
    // carries on. Write replaces the whole span it traverses, from where the
    // pass began. With no gesture this pass `lastValue` is null (write never
    // touched, latch never latched) and the guards below leave the lane alone —
    // explicitly: a pass with no new gesture records nothing and clears nothing.
    const latchStartBeat = session.passWriteStartBeat ?? (points.length > 0 ? points[0]!.beat : session.startBeat);
    const heldFromBeat = mode === 'latch' ? latchStartBeat : session.startBeat;

    let endBeat = lastGestureBeat ?? session.startBeat;
    if (overwrites && boundaryRawBeat !== null && session.lastValue !== null) {
        // `lastValue` is set in the same call that seeds `tempoAtStart`, so a
        // held session always carries the tempo its beats were recorded under.
        const tempo = session.tempoAtStart;
        if (tempo !== null && tempo !== undefined) {
            const boundaryBeat = latencyCompensatedBeat(boundaryRawBeat, session.trackId, tempo);
            if (boundaryBeat > endBeat) {
                // Hold the last gesture value through the boundary. Strictly
                // greater: at a loop wrap the boundary is the pass's own last
                // raw beat, and duplicating that beat would break the lane's
                // strictly-ordered-points invariant for zero replay gain.
                endBeat = boundaryBeat;
                points.push({ beat: boundaryBeat, value: session.lastValue, curve: 'linear', tension: 0 });
            }
        }
    }

    if (overwrites && laneId && session.lastValue !== null && endBeat > heldFromBeat) {
        clearPointsInRange(laneId, heldFromBeat, endBeat);
    }

    flushPendingPoints(key);
}
