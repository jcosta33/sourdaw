/**
 * Drag interaction helpers for AutomationLaneRow.
 * Each function handles one interaction mode and uses startMouseDrag
 * to manage global listener teardown.
 */
import { type MouseEvent as ReactMouseEvent } from 'react';

import { automationStore } from '#/modules/Automation/stores';
import {
    addAutomationPoint,
    removeAutomationPointById,
    updateAutomationPoint,
    setAutomationPointCurve,
    beginDrawSession,
    paintDrawPoint,
    endDrawSession,
    cancelDrawSession,
    selectPointsInRange,
} from '#/modules/Automation/useCases';
import { pushUndoEntry } from '#/modules/Command/useCases';
import { evaluateAutomationCurve } from '#/utils/automationCurve';

import { type AutomationLane, type AutomationPoint, type AutomationCurveType } from '../../models/AutomationViewTypes';

import { startMouseDrag } from './mouseDrag';

type SetStateFn<State> = (updater: State | ((prev: State) => State)) => void;

type CoordFns = {
    getRect: () => DOMRect | undefined;
    xToBeat: (x: number) => number;
    yToValue: (y: number) => number;
};

/** No drag started (bad rect, click landed on a child control, …) — nothing for a caller to cancel. */
const noopCancel = (): void => undefined;

/** Cancel handle for an in-flight drag, so an owning component can tear it down on unmount. */
export type DragCancel = () => void;

// ── Draw mode ────────────────────────────────────────────────────────────────

export const onDrawMouseDown = (
    event: ReactMouseEvent,
    lane: AutomationLane,
    snapValue: number,
    coords: CoordFns
): DragCancel => {
    const rect = coords.getRect();
    if (!rect) {
        return noopCancel;
    }
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    beginDrawSession(lane.id, snapValue, event.shiftKey);
    paintDrawPoint(Math.max(0, coords.xToBeat(x)), coords.yToValue(y));
    return startMouseDrag(
        (me) => {
            paintDrawPoint(Math.max(0, coords.xToBeat(me.clientX - rect.left)), coords.yToValue(me.clientY - rect.top));
        },
        () => {
            endDrawSession();
        },
        () => {
            cancelDrawSession();
        }
    );
};

// ── Point insertion ──────────────────────────────────────────────────────────

/** Add one point to a lane as a single undoable edit, addressed by its own id. */
const addPointWithUndo = (laneId: string, fields: Omit<AutomationPoint, 'id'>): void => {
    // The id is what makes the undo side remove exactly the point this edit
    // added; removing by beat would also take any other point already sitting
    // at the same beat.
    const pointId = `auto-point-${crypto.randomUUID()}`;
    const point: AutomationPoint = { id: pointId, ...fields };
    addAutomationPoint(laneId, point);
    pushUndoEntry(
        'Add automation point',
        () => {
            removeAutomationPointById(laneId, pointId);
        },
        () => {
            addAutomationPoint(laneId, point);
        }
    );
};

/** Add one linear point where the click landed, as a single undoable edit. */
export const addAutomationPointWithUndo = (laneId: string, beat: number, value: number): void => {
    addPointWithUndo(laneId, { beat, value, curve: 'linear', tension: 0 });
};

/**
 * Curve families a point can split at any interior beat with both halves
 * replaying the source values: a straight ramp restricted to a sub-span is the
 * same ramp, and a hold is a hold. The other families are laws of the segment
 * fraction that do not commute with re-basing a sub-span onto [0,1] (the
 * analysis beside the clip split's seam in `splitClipSatellites.ts`): `stairs`
 * re-spaces its steps, `exponential` and `s-curve` are no longer powers or
 * smoothsteps of the new fraction, and an exact `bezier` split would also
 * rewrite the left point's control points, which no automation write offers.
 */
const SPLIT_EXACT_CURVES: ReadonlySet<AutomationCurveType> = new Set(['linear', 'step']);

/** `bezier` with authored controls and `smooth` read more than the two segment values, so a flat span is not flat for them. */
const FLAT_EXACT_CURVES: ReadonlySet<AutomationCurveType> = new Set([
    'linear',
    'step',
    'stairs',
    'exponential',
    's-curve',
]);

/**
 * The point that splits the lane at `beat` without changing what it plays on
 * either side, or `undefined` when no such point exists. `smooth` segments
 * take their tangents from the neighbouring points, so a point next to one
 * changes it and is refused.
 */
const resolveShapePreservingPoint = (
    points: readonly AutomationPoint[],
    beat: number
): Omit<AutomationPoint, 'id'> | undefined => {
    if (points.length === 0 || points.some((point) => point.beat === beat)) {
        return undefined;
    }
    const rightIndex = points.findIndex((point) => point.beat > beat);
    const leftIndex = rightIndex === -1 ? points.length - 1 : rightIndex - 1;
    const left = points[leftIndex];
    const right = rightIndex === -1 ? undefined : points[rightIndex];
    if (left === undefined) {
        // Before the first point the lane holds that point's value; a flat
        // ramp up to it holds the same value.
        return right === undefined ? undefined : { beat, value: right.value, curve: 'linear', tension: 0 };
    }
    if (left.curve === 'smooth' || points[leftIndex - 1]?.curve === 'smooth' || right?.curve === 'smooth') {
        return undefined;
    }
    if (right === undefined) {
        // After the last point the lane holds its value; the new segment
        // between two equal values must stay flat under the left point's curve.
        return FLAT_EXACT_CURVES.has(left.curve) ? continueShapeOf(left, beat, left.value) : undefined;
    }
    if (!SPLIT_EXACT_CURVES.has(left.curve)) {
        return undefined;
    }
    return continueShapeOf(left, beat, evaluateAutomationCurve({ firstPoint: left, secondPoint: right, beat }));
};

/** A point at `beat` carrying the shape of the segment it splits, which its left point owns. */
const continueShapeOf = (left: AutomationPoint, beat: number, value: number): Omit<AutomationPoint, 'id'> => {
    const point: Omit<AutomationPoint, 'id'> = { beat, value, curve: left.curve, tension: left.tension };
    if (left.stairSteps !== undefined) {
        point.stairSteps = left.stairSteps;
    }
    return point;
};

/**
 * Add a point at `beat` that leaves the lane's evaluated values unchanged on
 * both sides, as one undoable edit. Returns false, adding nothing, when the
 * lane's shape at that beat cannot be split exactly. The keyboard insert uses
 * it; click-to-add keeps its linear point.
 */
export const insertAutomationPointPreservingShape = (laneId: string, beat: number): boolean => {
    const lane = automationStore.value?.lanes.find((candidate) => candidate.id === laneId);
    if (lane === undefined) {
        return false;
    }
    const point = resolveShapePreservingPoint(lane.points, beat);
    if (point === undefined) {
        return false;
    }
    addPointWithUndo(laneId, point);
    return true;
};

// ── Rubber-band selection ────────────────────────────────────────────────────

export const onRubberBandStart = (
    event: ReactMouseEvent,
    lane: AutomationLane,
    setRubberBand: SetStateFn<{ x1: number; y1: number; x2: number; y2: number } | null>,
    setSelectedPoints: SetStateFn<number[]>,
    coords: CoordFns
): DragCancel => {
    const isOnPoint = (event.target as Element).closest('[data-auto-point]');
    const isOnTension = (event.target as Element).closest('[data-tension-handle]');
    if (isOnPoint || isOnTension) {
        return noopCancel;
    }
    const rect = coords.getRect();
    if (!rect) {
        return noopCancel;
    }
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const isShift = event.shiftKey;

    if (!isShift) {
        setSelectedPoints([]);
    }
    setRubberBand({ x1: x, y1: y, x2: x, y2: y });

    return startMouseDrag(
        (me) => {
            setRubberBand((prev) => {
                if (!prev) {
                    return null;
                }
                return { ...prev, x2: me.clientX - rect.left, y2: me.clientY - rect.top };
            });
        },
        (me) => {
            const mx = me.clientX - rect.left;
            const my = me.clientY - rect.top;
            const hasDragged = Math.abs(mx - x) > 4 || Math.abs(my - y) > 4;
            if (hasDragged) {
                const found = selectPointsInRange(
                    lane.id,
                    coords.xToBeat(Math.min(x, mx)),
                    coords.xToBeat(Math.max(x, mx)),
                    coords.yToValue(Math.max(y, my)),
                    coords.yToValue(Math.min(y, my))
                );
                if (isShift) {
                    setSelectedPoints((prev) => {
                        const set = new Set(prev);
                        for (const beat of found) {
                            if (set.has(beat)) {
                                set.delete(beat);
                            } else {
                                set.add(beat);
                            }
                        }
                        return [...set];
                    });
                } else {
                    setSelectedPoints(found);
                }
            } else if (!isShift) {
                addAutomationPointWithUndo(lane.id, Math.max(0, coords.xToBeat(x)), coords.yToValue(y));
            }
            setRubberBand(null);
        },
        () => {
            // Nothing was ever committed to the store during this gesture — the
            // point-add and range-selection both happen at mouseup, never in
            // `onMove` — so cancel only has to drop the rectangle's local state.
            setRubberBand(null);
        }
    );
};

// ── Tension handle drag ───────────────────────────────────────────────────────

export const onTensionMouseDown = (
    pointBeat: number,
    event: ReactMouseEvent,
    lane: AutomationLane,
    setTensionDrag: SetStateFn<{ beat: number; initialTension: number } | null>
): DragCancel => {
    event.stopPropagation();
    const point = lane.points.find((param) => param.beat === pointBeat);
    if (!point) {
        return noopCancel;
    }
    const initialTension = point.tension ?? 0;
    setTensionDrag({ beat: pointBeat, initialTension });
    const startY = event.clientY;
    return startMouseDrag(
        (me) => {
            const newTension = Math.max(-1, Math.min(1, initialTension + (me.clientY - startY) / 100));
            setAutomationPointCurve(lane.id, pointBeat, point.curve, newTension);
        },
        () => {
            setTensionDrag(null);
        },
        () => {
            // `onMove` already wrote every intermediate tension straight to the
            // store (there is no separate commit step), so cancel must put the
            // point's tension back the way it was, not just drop local UI state.
            setAutomationPointCurve(lane.id, pointBeat, point.curve, initialTension);
            setTensionDrag(null);
        }
    );
};

// ── Breakpoint drag ───────────────────────────────────────────────────────────

export const onPointMouseDown = (
    pointBeat: number,
    event: ReactMouseEvent,
    lane: AutomationLane,
    setDragPointBeat: SetStateFn<number | null>,
    setSelectedPoints: SetStateFn<number[]>,
    coords: CoordFns,
    pointId?: string
): DragCancel => {
    event.stopPropagation();
    const rect = coords.getRect();
    if (!rect) {
        return noopCancel;
    }

    if (event.shiftKey) {
        setSelectedPoints((prev) =>
            prev.includes(pointBeat) ? prev.filter((b) => b !== pointBeat) : [...prev, pointBeat]
        );
        return noopCancel;
    }

    const candidates = lane.points.filter((point) => {
        if (pointId !== undefined) {
            return pointId.length > 0 && point.id === pointId;
        }
        return Math.abs(point.beat - pointBeat) < 0.05;
    });
    if (candidates.length !== 1) {
        return noopCancel;
    }
    const origPoint = candidates[0];
    if (!origPoint) {
        return noopCancel;
    }
    const capturedId = origPoint.id;
    const origBeat = origPoint.beat;
    const origValue = origPoint.value;
    let currentBeat = origBeat;
    setDragPointBeat(origBeat);

    return startMouseDrag(
        (me) => {
            let newBeat = Math.max(0, coords.xToBeat(me.clientX - rect.left));
            let newValue = coords.yToValue(me.clientY - rect.top);
            if (me.shiftKey) {
                const dx = Math.abs(newBeat - origBeat);
                const dy = Math.abs(newValue - origValue);
                if (dx > dy) {
                    newValue = origValue;
                } else {
                    newBeat = origBeat;
                }
            }
            if (!updateAutomationPoint(lane.id, currentBeat, newValue, newBeat, capturedId)) {
                return;
            }
            currentBeat = newBeat;
            setDragPointBeat(newBeat);
        },
        () => {
            setDragPointBeat(null);
            const finalLane = automationStore.value?.lanes.find((length) => length.id === lane.id);
            // Identified gestures keep their original target across crossings and
            // same-beat neighbors. Legacy points have only a unique exact beat.
            const finalCandidates = finalLane?.points.filter((point) => {
                if (capturedId !== undefined) {
                    return point.id === capturedId;
                }
                return point.beat === currentBeat;
            });
            const finalPoint = finalCandidates?.length === 1 ? finalCandidates[0] : undefined;
            const hasMoved =
                finalPoint !== undefined && (finalPoint.beat !== origBeat || finalPoint.value !== origValue);
            if (hasMoved) {
                const finalBeat = finalPoint.beat;
                const finalValue = finalPoint.value;
                pushUndoEntry(
                    'Move automation point',
                    () => {
                        updateAutomationPoint(lane.id, finalBeat, origValue, origBeat, capturedId);
                    },
                    () => {
                        updateAutomationPoint(lane.id, origBeat, finalValue, finalBeat, capturedId);
                    }
                );
            }
        },
        () => {
            // `onMove` already wrote every intermediate position straight to the
            // store, so cancel must revert the point back to where it started —
            // through the same use case a commit would use — rather than just
            // clearing local UI state. No undo entry: reverting makes this a net
            // no-op, so there is nothing for the user to undo.
            updateAutomationPoint(lane.id, currentBeat, origValue, origBeat, capturedId);
            setDragPointBeat(null);
        }
    );
};

// ── Curve select (from context menu) ─────────────────────────────────────────

export const applyCurveSelect = (laneId: string, beat: number, curve: AutomationCurveType): void => {
    setAutomationPointCurve(laneId, beat, curve, 0.5);
};
