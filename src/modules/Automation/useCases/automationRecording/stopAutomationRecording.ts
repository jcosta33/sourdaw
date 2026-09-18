import { trackStore } from '#/modules/Arrangement/stores';
import { pushUndoEntry } from '#/modules/Command/useCases';

import { type AutomationPoint } from '../../models/Automation';
import { automationStore } from '../../stores/automationStore';

import { pendingAutoMatch } from './autoMatchState';
import { commitRecordedPass } from './commitRecordedPass';
import { activeRecording, laneBaselines, pendingPoints, touchActive } from './recordingSessionState';

/** Snapshot the points of one lane, or null if the lane is absent. */
function snapshotLanePoints(laneId: string): AutomationPoint[] | null {
    const lane = automationStore.value?.lanes.find((length) => length.id === laneId);
    return lane ? lane.points.map((point) => ({ ...point })) : null;
}

function controlPointsEqual(
    left: { x: number; y: number } | undefined,
    right: { x: number; y: number } | undefined
): boolean {
    return left?.x === right?.x && left?.y === right?.y;
}

/**
 * Structural, order-independent equality over two lane point arrays. As the
 * undo-entry decider it must compare every field a recorded pass can change: a
 * curve-shape-only edit (stairSteps, cp1/cp2) differs from the baseline in no
 * other field, so a partial comparison would leave the pass without an undo.
 */
function pointsEqual(a: AutomationPoint[], b: AutomationPoint[]): boolean {
    if (a.length !== b.length) {
        return false;
    }
    for (let i = 0; i < a.length; i += 1) {
        const left = a[i]!;
        const right = b[i]!;
        if (
            left.beat !== right.beat ||
            left.value !== right.value ||
            left.curve !== right.curve ||
            left.tension !== right.tension ||
            left.stairSteps !== right.stairSteps ||
            !controlPointsEqual(left.cp1, right.cp1) ||
            !controlPointsEqual(left.cp2, right.cp2)
        ) {
            return false;
        }
    }
    return true;
}

/**
 * Commit every active recording session at a transport boundary.
 *
 * `finalBoundaryBeat` is the beat the audible transport actually stood at when
 * the boundary hit — the moving cursor at the stop/pause/seek, supplied by the
 * Transport-owned scheduler teardown (`stopPlayheadScheduler` reads it before
 * anything resets the clock). Without it the pass can only commit through its
 * last buffered gesture, and write/latch passes silently drop the held tail:
 * the lane replays the old curve the pass had suppressed (#3798). Omitting it
 * (no argument) keeps the last-gesture behavior for callers without a live
 * clock to read.
 */
export function stopAutomationRecording(finalBoundaryBeat?: number): void {
    const tracks = trackStore.value?.tracks ?? [];

    // Per-lane before/after snapshots, scoped to ONLY the lanes this session
    // touched. A whole-store snapshot would let undo clobber concurrent edits
    // to other lanes (and order-sensitive JSON.stringify defeats the CRDT merge).
    //
    // The "before" side is `laneBaselines`, captured before each lane's FIRST
    // write in this session — not here. A touch release flushes its points into
    // the lane mid-session, so a snapshot taken at stop would already contain
    // the pass, diff to nothing, and leave the whole recording without an undo
    // entry (audit M-052).
    for (const [key, session] of activeRecording) {
        const track = tracks.find((time) => time.id === session.trackId);
        // write + latch overwrite the span they pass over. A loop wrap ends a
        // pass the same way a stop does, so both go through the same commit.
        if (track?.automationMode === 'write' || track?.automationMode === 'latch') {
            commitRecordedPass(key, track.automationMode, finalBoundaryBeat ?? null);
            continue;
        }
        // Touch (and any non-overwriting mode) only flushes; its release keeps
        // the separate AutoMatch return-to-curve behavior.
        commitRecordedPass(key, 'touch', null);
    }

    // Build the scoped undo from the lanes actually touched. Each callback maps
    // over the CURRENT store lanes and replaces `points` for only the affected
    // lanes — leaving concurrent edits to every other lane intact.
    const laneEdits: Array<{ laneId: string; beforePoints: AutomationPoint[]; afterPoints: AutomationPoint[] }> = [];
    for (const [laneId, beforePoints] of laneBaselines) {
        const afterPoints = snapshotLanePoints(laneId) ?? [];
        if (!pointsEqual(beforePoints, afterPoints)) {
            laneEdits.push({ laneId, beforePoints, afterPoints });
        }
    }

    if (laneEdits.length > 0) {
        pushUndoEntry(
            'Record Automation',
            () => {
                const current = automationStore.value;
                if (!current) {
                    return;
                }
                const restore = new Map(laneEdits.map((edit) => [edit.laneId, edit.beforePoints]));
                automationStore.set({
                    lanes: current.lanes.map((lane) =>
                        restore.has(lane.id) ? { ...lane, points: restore.get(lane.id)! } : lane
                    ),
                });
            },
            () => {
                const current = automationStore.value;
                if (!current) {
                    return;
                }
                const restore = new Map(laneEdits.map((edit) => [edit.laneId, edit.afterPoints]));
                automationStore.set({
                    lanes: current.lanes.map((lane) =>
                        restore.has(lane.id) ? { ...lane, points: restore.get(lane.id)! } : lane
                    ),
                });
            }
        );
    }

    activeRecording.clear();
    pendingPoints.clear();
    touchActive.clear();
    laneBaselines.clear();
    // A stop or locate ends the session outright, so any AutoMatch glide
    // still in flight is abandoned rather than resumed against a clock that has
    // since jumped. Without this a pending release would blend on the first tick
    // after the next play, from a value belonging to the previous session.
    pendingAutoMatch.clear();
}
