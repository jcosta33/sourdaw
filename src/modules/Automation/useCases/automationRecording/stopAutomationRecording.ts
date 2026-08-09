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

/** Structural, order-independent equality over two lane point arrays. */
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
            left.tension !== right.tension
        ) {
            return false;
        }
    }
    return true;
}

export function stopAutomationRecording(): void {
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
        const overwrites = track?.automationMode === 'write' || track?.automationMode === 'latch';
        commitRecordedPass(key, overwrites);
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
