/**
 * Drag interaction helpers for AutomationLaneRow.
 * Each function handles one interaction mode and uses startMouseDrag
 * to manage global listener teardown.
 */
import { type MouseEvent as ReactMouseEvent } from 'react';
import { type AutomationLane, type AutomationPoint, type AutomationCurveType } from '../../models/AutomationViewTypes';
import {
    addAutomationPoint,
    removeAutomationPoint,
    updateAutomationPoint,
    setAutomationPointCurve,
    beginDrawSession,
    paintDrawPoint,
    endDrawSession,
    selectPointsInRange,
    automationStore,
} from '#/modules/Automation';
import { pushUndoEntry } from '#/modules/Command';
import { startMouseDrag } from './mouseDrag';

type SetStateFn<T> = (updater: T | ((prev: T) => T)) => void;

type CoordFns = {
    getRect: () => DOMRect | undefined;
    xToBeat: (x: number) => number;
    yToValue: (y: number) => number;
};

// ── Draw mode ────────────────────────────────────────────────────────────────

export const onDrawMouseDown = (
    e: ReactMouseEvent,
    lane: AutomationLane,
    snapValue: number,
    coords: CoordFns
): void => {
    const rect = coords.getRect();
    if (!rect) {
        return;
    }
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    beginDrawSession(lane.id, snapValue, e.shiftKey);
    paintDrawPoint(Math.max(0, coords.xToBeat(x)), coords.yToValue(y));
    startMouseDrag(
        (me) => {
            paintDrawPoint(Math.max(0, coords.xToBeat(me.clientX - rect.left)), coords.yToValue(me.clientY - rect.top));
        },
        () => {
            endDrawSession();
        }
    );
};

// ── Rubber-band selection ────────────────────────────────────────────────────

export const onRubberBandStart = (
    e: ReactMouseEvent,
    lane: AutomationLane,
    setRubberBand: SetStateFn<{ x1: number; y1: number; x2: number; y2: number } | null>,
    setSelectedPoints: SetStateFn<number[]>,
    coords: CoordFns
): void => {
    const isOnPoint = (e.target as Element).closest('[data-auto-point]');
    const isOnTension = (e.target as Element).closest('[data-tension-handle]');
    if (isOnPoint || isOnTension) {
        return;
    }
    const rect = coords.getRect();
    if (!rect) {
        return;
    }
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const isShift = e.shiftKey;

    if (!isShift) {
        setSelectedPoints([]);
    }
    setRubberBand({ x1: x, y1: y, x2: x, y2: y });

    startMouseDrag(
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
                const beat = Math.max(0, coords.xToBeat(x));
                const value = coords.yToValue(y);
                const point: AutomationPoint = { beat, value, curve: 'linear', tension: 0 };
                addAutomationPoint(lane.id, point);
                pushUndoEntry(
                    'Add automation point',
                    () => {
                        removeAutomationPoint(lane.id, beat);
                    },
                    () => {
                        addAutomationPoint(lane.id, point);
                    }
                );
            }
            setRubberBand(null);
        }
    );
};

// ── Tension handle drag ───────────────────────────────────────────────────────

export const onTensionMouseDown = (
    pointBeat: number,
    e: ReactMouseEvent,
    lane: AutomationLane,
    setTensionDrag: SetStateFn<{ beat: number; initialTension: number } | null>
): void => {
    e.stopPropagation();
    const point = lane.points.find((p) => p.beat === pointBeat);
    if (!point) {
        return;
    }
    const initialTension = point.tension ?? 0;
    setTensionDrag({ beat: pointBeat, initialTension });
    const startY = e.clientY;
    startMouseDrag(
        (me) => {
            const newTension = Math.max(-1, Math.min(1, initialTension + (me.clientY - startY) / 100));
            setAutomationPointCurve(lane.id, pointBeat, point.curve, newTension);
        },
        () => {
            setTensionDrag(null);
        }
    );
};

// ── Breakpoint drag ───────────────────────────────────────────────────────────

export const onPointMouseDown = (
    pointBeat: number,
    e: ReactMouseEvent,
    lane: AutomationLane,
    setDragPointBeat: SetStateFn<number | null>,
    setSelectedPoints: SetStateFn<number[]>,
    coords: CoordFns
): void => {
    e.stopPropagation();
    const rect = coords.getRect();
    if (!rect) {
        return;
    }

    if (e.shiftKey) {
        setSelectedPoints((prev) =>
            prev.includes(pointBeat) ? prev.filter((b) => b !== pointBeat) : [...prev, pointBeat]
        );
        return;
    }

    const origPoint = lane.points.find((p) => p.beat === pointBeat);
    if (!origPoint) {
        return;
    }
    const origBeat = origPoint.beat;
    const origValue = origPoint.value;
    let currentBeat = pointBeat;
    setDragPointBeat(pointBeat);

    startMouseDrag(
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
            updateAutomationPoint(lane.id, currentBeat, newValue, newBeat);
            currentBeat = newBeat;
            setDragPointBeat(newBeat);
        },
        () => {
            setDragPointBeat(null);
            const finalLane = automationStore.value?.lanes.find((l) => l.id === lane.id);
            const finalPoint = finalLane?.points.find((p) => Math.abs(p.beat - currentBeat) < 0.05);
            const hasMoved =
                finalPoint !== undefined && (finalPoint.beat !== origBeat || finalPoint.value !== origValue);
            if (hasMoved) {
                const finalBeat = finalPoint!.beat;
                const finalValue = finalPoint!.value;
                pushUndoEntry(
                    'Move automation point',
                    () => {
                        updateAutomationPoint(lane.id, finalBeat, origValue, origBeat);
                    },
                    () => {
                        updateAutomationPoint(lane.id, origBeat, finalValue, finalBeat);
                    }
                );
            }
        }
    );
};

// ── Curve select (from context menu) ─────────────────────────────────────────

export const applyCurveSelect = (laneId: string, beat: number, curve: AutomationCurveType): void => {
    setAutomationPointCurve(laneId, beat, curve, 0.5);
};
