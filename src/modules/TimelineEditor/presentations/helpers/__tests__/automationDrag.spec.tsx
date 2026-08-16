import { type ReactElement, type MouseEvent as ReactMouseEvent } from 'react';

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type AutomationLane, type AutomationPoint } from '../../../models/AutomationViewTypes';
import {
    onDrawMouseDown,
    onRubberBandStart,
    onTensionMouseDown,
    onPointMouseDown,
    applyCurveSelect,
} from '../automationDrag';

const mocks = vi.hoisted(() => ({
    automationState: {
        lanes: [] as Array<{
            id: string;
            points: Array<{ beat: number; value: number; curve: string; tension: number }>;
        }>,
    },
    addAutomationPoint: vi.fn(),
    removeAutomationPoint: vi.fn(),
    updateAutomationPoint: vi.fn(),
    setAutomationPointCurve: vi.fn(),
    beginDrawSession: vi.fn(),
    paintDrawPoint: vi.fn(),
    endDrawSession: vi.fn(),
    selectPointsInRange: vi.fn(),
    pushUndoEntry: vi.fn(),
}));

vi.mock('#/modules/Automation/stores', () => ({
    automationStore: {
        get value() {
            return mocks.automationState;
        },
    },
}));

vi.mock('#/modules/Automation/useCases', () => ({
    addAutomationPoint: mocks.addAutomationPoint,
    removeAutomationPoint: mocks.removeAutomationPoint,
    updateAutomationPoint: mocks.updateAutomationPoint,
    setAutomationPointCurve: mocks.setAutomationPointCurve,
    beginDrawSession: mocks.beginDrawSession,
    paintDrawPoint: mocks.paintDrawPoint,
    endDrawSession: mocks.endDrawSession,
    selectPointsInRange: mocks.selectPointsInRange,
}));

vi.mock('#/modules/Command/useCases', () => ({
    pushUndoEntry: mocks.pushUndoEntry,
}));

// ── Fixtures ─────────────────────────────────────────────────────────────
// Coordinate mapping: 10px per beat, y 0..100 → value 1..0.
const coords = {
    getRect: (): DOMRect => new DOMRect(0, 0, 200, 100),
    xToBeat: (x: number): number => x / 10,
    yToValue: (y: number): number => 1 - y / 100,
};

const makePoint = (beat: number, value: number, overrides: Partial<AutomationPoint> = {}): AutomationPoint => ({
    beat,
    value,
    curve: 'linear',
    tension: 0,
    ...overrides,
});

const makeLane = (points: AutomationPoint[]): AutomationLane => ({
    id: 'lane-1',
    trackId: 'track-1',
    parameterId: 'volume',
    parameterName: 'Volume',
    points,
    objects: [],
    visible: true,
    enabled: true,
    collapsed: false,
    minValue: 0,
    maxValue: 1,
});

const setRubberBand = vi.fn();
const setSelectedPoints = vi.fn();
const setTensionDrag = vi.fn();
const setDragPointBeat = vi.fn();

type SurfaceProps = {
    onSurfaceMouseDown: (event: ReactMouseEvent<HTMLDivElement>) => void;
    withPointChild?: boolean;
};

const Surface = ({ onSurfaceMouseDown, withPointChild = false }: SurfaceProps): ReactElement => (
    <div aria-label="lane-surface" onMouseDown={onSurfaceMouseDown}>
        {withPointChild ? <button type="button" aria-label="existing-point" data-auto-point="true" /> : null}
    </div>
);

const renderSurface = (props: SurfaceProps): HTMLElement => {
    render(<Surface {...props} />);
    return screen.getByLabelText('lane-surface');
};

describe('automationDrag', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.automationState = { lanes: [] };
        mocks.selectPointsInRange.mockReturnValue([]);
    });

    describe('onDrawMouseDown', () => {
        it('begins a draw session, paints through the drag, and ends on mouse-up', () => {
            const lane = makeLane([]);
            const surface = renderSurface({
                onSurfaceMouseDown: (event) => onDrawMouseDown(event, lane, 0.25, coords),
            });

            fireEvent.mouseDown(surface, { clientX: 50, clientY: 40 });
            expect(mocks.beginDrawSession).toHaveBeenCalledWith('lane-1', 0.25, false);
            expect(mocks.paintDrawPoint).toHaveBeenCalledWith(5, 0.6);

            fireEvent.mouseMove(window, { clientX: 80, clientY: 20 });
            expect(mocks.paintDrawPoint).toHaveBeenLastCalledWith(8, 0.8);

            fireEvent.mouseUp(window, { clientX: 80, clientY: 20 });
            expect(mocks.endDrawSession).toHaveBeenCalledTimes(1);

            // Listeners are torn down: further movement paints nothing
            fireEvent.mouseMove(window, { clientX: 100, clientY: 10 });
            expect(mocks.paintDrawPoint).toHaveBeenCalledTimes(2);
        });

        it('passes shift state into the draw session and clamps beats at zero', () => {
            const lane = makeLane([]);
            const surface = renderSurface({
                onSurfaceMouseDown: (event) => onDrawMouseDown(event, lane, 1, coords),
            });

            fireEvent.mouseDown(surface, { clientX: -30, clientY: 40, shiftKey: true });

            expect(mocks.beginDrawSession).toHaveBeenCalledWith('lane-1', 1, true);
            expect(mocks.paintDrawPoint).toHaveBeenCalledWith(0, 0.6);
        });
    });

    describe('onRubberBandStart', () => {
        it('a click without drag adds an automation point with an undo entry', () => {
            const lane = makeLane([]);
            const surface = renderSurface({
                onSurfaceMouseDown: (event) => onRubberBandStart(event, lane, setRubberBand, setSelectedPoints, coords),
            });

            fireEvent.mouseDown(surface, { clientX: 50, clientY: 40 });
            expect(setSelectedPoints).toHaveBeenCalledWith([]);
            expect(setRubberBand).toHaveBeenCalledWith({ x1: 50, y1: 40, x2: 50, y2: 40 });

            fireEvent.mouseUp(window, { clientX: 50, clientY: 40 });

            expect(mocks.addAutomationPoint).toHaveBeenCalledWith('lane-1', {
                beat: 5,
                value: 0.6,
                curve: 'linear',
                tension: 0,
            });
            expect(mocks.pushUndoEntry).toHaveBeenCalledWith(
                'Add automation point',
                expect.any(Function),
                expect.any(Function)
            );

            const undoFn = mocks.pushUndoEntry.mock.calls[0]?.[1];
            undoFn();
            expect(mocks.removeAutomationPoint).toHaveBeenCalledWith('lane-1', 5);
        });

        it('a meaningful drag selects the points in range instead of adding one', () => {
            mocks.selectPointsInRange.mockReturnValue([1, 2]);
            const lane = makeLane([]);
            const surface = renderSurface({
                onSurfaceMouseDown: (event) => onRubberBandStart(event, lane, setRubberBand, setSelectedPoints, coords),
            });

            fireEvent.mouseDown(surface, { clientX: 50, clientY: 40 });
            fireEvent.mouseMove(window, { clientX: 150, clientY: 80 });

            const updater = setRubberBand.mock.lastCall?.[0];
            expect(updater({ x1: 50, y1: 40, x2: 50, y2: 40 })).toEqual({ x1: 50, y1: 40, x2: 150, y2: 80 });

            fireEvent.mouseUp(window, { clientX: 150, clientY: 80 });

            // beats 5..15, values low→high from the y extremes
            expect(mocks.selectPointsInRange).toHaveBeenCalledWith('lane-1', 5, 15, expect.closeTo(0.2), 0.6);
            expect(setSelectedPoints).toHaveBeenLastCalledWith([1, 2]);
            expect(mocks.addAutomationPoint).not.toHaveBeenCalled();
            expect(setRubberBand).toHaveBeenLastCalledWith(null);
        });

        it('shift-drag toggles the found points against the previous selection', () => {
            mocks.selectPointsInRange.mockReturnValue([1, 2]);
            const lane = makeLane([]);
            const surface = renderSurface({
                onSurfaceMouseDown: (event) => onRubberBandStart(event, lane, setRubberBand, setSelectedPoints, coords),
            });

            fireEvent.mouseDown(surface, { clientX: 50, clientY: 40, shiftKey: true });
            // Shift keeps the previous selection alive on mouse-down
            expect(setSelectedPoints).not.toHaveBeenCalled();

            fireEvent.mouseMove(window, { clientX: 150, clientY: 80 });
            fireEvent.mouseUp(window, { clientX: 150, clientY: 80 });

            const updater = setSelectedPoints.mock.lastCall?.[0];
            expect(typeof updater).toBe('function');
            expect(updater([1])).toEqual([2]);
            expect(updater([3])).toEqual(expect.arrayContaining([1, 2, 3]));
        });

        it('does nothing when the press starts on an existing point element', () => {
            const lane = makeLane([]);
            renderSurface({
                onSurfaceMouseDown: (event) => onRubberBandStart(event, lane, setRubberBand, setSelectedPoints, coords),
                withPointChild: true,
            });

            fireEvent.mouseDown(screen.getByLabelText('existing-point'), { clientX: 10, clientY: 10 });

            expect(setRubberBand).not.toHaveBeenCalled();
            expect(setSelectedPoints).not.toHaveBeenCalled();
        });
    });

    describe('onTensionMouseDown', () => {
        it('dragging vertically retunes the tension, clamped to [-1, 1]', () => {
            const lane = makeLane([makePoint(2, 0.5, { curve: 's-curve', tension: 0.2 })]);
            const surface = renderSurface({
                onSurfaceMouseDown: (event) => onTensionMouseDown(2, event, lane, setTensionDrag),
            });

            fireEvent.mouseDown(surface, { clientX: 20, clientY: 100 });
            expect(setTensionDrag).toHaveBeenCalledWith({ beat: 2, initialTension: 0.2 });

            fireEvent.mouseMove(window, { clientX: 20, clientY: 130 });
            expect(mocks.setAutomationPointCurve).toHaveBeenLastCalledWith('lane-1', 2, 's-curve', 0.5);

            fireEvent.mouseMove(window, { clientX: 20, clientY: 400 });
            expect(mocks.setAutomationPointCurve).toHaveBeenLastCalledWith('lane-1', 2, 's-curve', 1);

            fireEvent.mouseUp(window, { clientX: 20, clientY: 400 });
            expect(setTensionDrag).toHaveBeenLastCalledWith(null);
        });

        it('ignores a beat with no matching point', () => {
            const lane = makeLane([makePoint(2, 0.5)]);
            const surface = renderSurface({
                onSurfaceMouseDown: (event) => onTensionMouseDown(99, event, lane, setTensionDrag),
            });

            fireEvent.mouseDown(surface, { clientX: 20, clientY: 100 });

            expect(setTensionDrag).not.toHaveBeenCalled();
            expect(mocks.setAutomationPointCurve).not.toHaveBeenCalled();
        });
    });

    describe('onPointMouseDown', () => {
        it('shift-click toggles the point in the selection without starting a drag', () => {
            const lane = makeLane([makePoint(2, 0.5)]);
            const surface = renderSurface({
                onSurfaceMouseDown: (event) =>
                    onPointMouseDown(2, event, lane, setDragPointBeat, setSelectedPoints, coords),
            });

            fireEvent.mouseDown(surface, { clientX: 20, clientY: 50, shiftKey: true });

            const updater = setSelectedPoints.mock.calls[0]?.[0];
            expect(updater([2, 7])).toEqual([7]);
            expect(updater([7])).toEqual([7, 2]);
            expect(setDragPointBeat).not.toHaveBeenCalled();
        });

        it('dragging moves the point continuously and records one undo entry at release', () => {
            const lane = makeLane([makePoint(2, 0.5)]);
            mocks.automationState = {
                lanes: [{ id: 'lane-1', points: [{ beat: 4, value: 0.7, curve: 'linear', tension: 0 }] }],
            };
            const surface = renderSurface({
                onSurfaceMouseDown: (event) =>
                    onPointMouseDown(2, event, lane, setDragPointBeat, setSelectedPoints, coords),
            });

            fireEvent.mouseDown(surface, { clientX: 20, clientY: 50 });
            expect(setDragPointBeat).toHaveBeenCalledWith(2);

            fireEvent.mouseMove(window, { clientX: 40, clientY: 30 });
            expect(mocks.updateAutomationPoint).toHaveBeenCalledWith('lane-1', 2, 0.7, 4);
            expect(setDragPointBeat).toHaveBeenLastCalledWith(4);

            // The next move addresses the point at its new beat
            fireEvent.mouseMove(window, { clientX: 50, clientY: 30 });
            expect(mocks.updateAutomationPoint).toHaveBeenLastCalledWith('lane-1', 4, 0.7, 5);

            mocks.automationState = {
                lanes: [{ id: 'lane-1', points: [{ beat: 5, value: 0.7, curve: 'linear', tension: 0 }] }],
            };
            fireEvent.mouseUp(window, { clientX: 50, clientY: 30 });

            expect(setDragPointBeat).toHaveBeenLastCalledWith(null);
            expect(mocks.pushUndoEntry).toHaveBeenCalledWith(
                'Move automation point',
                expect.any(Function),
                expect.any(Function)
            );
        });

        it('shift while dragging locks to the dominant axis', () => {
            const lane = makeLane([makePoint(2, 0.5)]);
            const surface = renderSurface({
                onSurfaceMouseDown: (event) =>
                    onPointMouseDown(2, event, lane, setDragPointBeat, setSelectedPoints, coords),
            });

            fireEvent.mouseDown(surface, { clientX: 20, clientY: 50 });
            // dx (4 beats) dominates dy (0.05) → value stays at the original 0.5
            fireEvent.mouseMove(window, { clientX: 60, clientY: 45, shiftKey: true });

            expect(mocks.updateAutomationPoint).toHaveBeenLastCalledWith('lane-1', 2, 0.5, 6);
        });

        it('matches the dragged point by exact final beat, not a nearby point within the old tolerance', () => {
            const lane = makeLane([makePoint(2, 0.5)]);
            // Array order matters: `.find` returns the first match. This
            // unrelated, stationary point merely happens to land within the old
            // `< 0.05` tolerance of where the drag ends, and it sorts before the
            // point that actually moved.
            mocks.automationState = {
                lanes: [
                    {
                        id: 'lane-1',
                        points: [
                            { beat: 4.98, value: 0.9, curve: 'linear', tension: 0 }, // unrelated, stationary
                            { beat: 5, value: 0.7, curve: 'linear', tension: 0 }, // the point actually dragged here
                        ],
                    },
                ],
            };
            const surface = renderSurface({
                onSurfaceMouseDown: (event) =>
                    onPointMouseDown(2, event, lane, setDragPointBeat, setSelectedPoints, coords),
            });

            fireEvent.mouseDown(surface, { clientX: 20, clientY: 50 });
            fireEvent.mouseMove(window, { clientX: 50, clientY: 30 }); // → beat 5, value 0.7
            fireEvent.mouseUp(window, { clientX: 50, clientY: 30 });

            expect(mocks.pushUndoEntry).toHaveBeenCalledWith(
                'Move automation point',
                expect.any(Function),
                expect.any(Function)
            );

            // The undo must restore from the point that actually moved (beat 5,
            // value 0.7) — a tolerance match would instead read the unrelated
            // stationary point's (beat 4.98, value 0.9).
            const undoFn = mocks.pushUndoEntry.mock.calls[0]?.[1];
            undoFn();
            expect(mocks.updateAutomationPoint).toHaveBeenLastCalledWith('lane-1', 5, 0.5, 2);
        });

        it('releasing without movement records no undo entry', () => {
            const lane = makeLane([makePoint(2, 0.5)]);
            mocks.automationState = {
                lanes: [{ id: 'lane-1', points: [{ beat: 2, value: 0.5, curve: 'linear', tension: 0 }] }],
            };
            const surface = renderSurface({
                onSurfaceMouseDown: (event) =>
                    onPointMouseDown(2, event, lane, setDragPointBeat, setSelectedPoints, coords),
            });

            fireEvent.mouseDown(surface, { clientX: 20, clientY: 50 });
            fireEvent.mouseUp(window, { clientX: 20, clientY: 50 });

            expect(mocks.pushUndoEntry).not.toHaveBeenCalled();
        });
    });

    describe('applyCurveSelect', () => {
        it('applies the picked curve with the default 0.5 tension', () => {
            applyCurveSelect('lane-1', 3, 'stairs');

            expect(mocks.setAutomationPointCurve).toHaveBeenCalledWith('lane-1', 3, 'stairs', 0.5);
        });
    });
});
