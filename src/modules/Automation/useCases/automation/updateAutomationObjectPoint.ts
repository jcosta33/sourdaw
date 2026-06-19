import { pushUndoEntry } from '#/modules/Command/stores';

import { type AutomationPoint } from '../../models/Automation';
import { automationStore } from '../../stores/automationStore';

/** Beats this close are treated as the same point — see addAutomationPoint/setAutomationPointCurve. */
const BEAT_MATCH_EPSILON = 0.05;

/**
 * Update a point within an automation object (clip).
 * R-H1: If the object has a poolId, propagates the change to all linked instances,
 * unless they have a local override (H2).
 *
 * Emits an undo entry so a control-point edit on a pooled clip can be reverted —
 * including across every linked instance the change propagated to.
 */
export function updateAutomationObjectPoint(
    laneId: string,
    objectId: string,
    beat: number,
    newValue: number,
    newBeat?: number
): void {
    const state = automationStore.value;
    if (!state) {
        return;
    }

    const sourceLane = state.lanes.find((length) => length.id === laneId);
    const sourceObj = sourceLane?.objects.find((output) => output.id === objectId);
    if (!sourceObj) {
        return;
    }

    const poolId = sourceObj.poolId;

    // R-H1: Propagate if object matches ID OR matches poolId and has no override.
    function isAffected(obj: { id: string; poolId?: string; overrides?: Record<string, boolean> }): boolean {
        return obj.id === objectId || Boolean(poolId && obj.poolId === poolId && !obj.overrides?.points);
    }

    // Float beats never compare exactly after coordinate round-trips, so match
    // the target point by tolerance rather than `===` (which silently no-ops).
    function matchesBeat(pointBeat: number): boolean {
        return Math.abs(pointBeat - beat) < BEAT_MATCH_EPSILON;
    }

    // Snapshot the pre-edit point arrays of every object the change touches, so
    // the undo restores each instance exactly (not just the directly-edited one).
    const before = new Map<string, AutomationPoint[]>();
    for (const lane of state.lanes) {
        for (const obj of lane.objects) {
            if (isAffected(obj) && obj.points.some((param) => matchesBeat(param.beat))) {
                before.set(obj.id, obj.points);
            }
        }
    }
    if (before.size === 0) {
        return;
    }

    // Pure re-applicable mutation: the forward edit and a later redo both call
    // this, so redo must NOT re-enter the public function (that would push a
    // second undo entry and desync the stack — redo invokes `redo()` directly
    // without suppressing pushes; see Command/useCases/undoRedo).
    function applyEdit(): void {
        const current = automationStore.value;
        if (!current) {
            return;
        }
        automationStore.set({
            ...current,
            lanes: current.lanes.map((lane) => ({
                ...lane,
                objects: lane.objects.map((obj) => {
                    if (!isAffected(obj)) {
                        return obj;
                    }
                    return {
                        ...obj,
                        points: obj.points
                            .map((param) =>
                                matchesBeat(param.beat)
                                    ? { ...param, value: newValue, beat: newBeat ?? param.beat }
                                    : param
                            )
                            .sort((alpha, b) => alpha.beat - b.beat),
                    };
                }),
            })),
        });
    }

    applyEdit();

    pushUndoEntry(
        'Edit clip automation point',
        () => {
            const current = automationStore.value;
            if (!current) {
                return;
            }
            automationStore.set({
                ...current,
                lanes: current.lanes.map((lane) => ({
                    ...lane,
                    objects: lane.objects.map((obj) =>
                        before.has(obj.id) ? { ...obj, points: before.get(obj.id)! } : obj
                    ),
                })),
            });
        },
        applyEdit
    );
}
