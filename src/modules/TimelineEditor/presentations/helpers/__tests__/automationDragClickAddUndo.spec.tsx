import { type ReactElement, type MouseEvent as ReactMouseEvent } from 'react';

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { automationStore } from '#/modules/Automation/stores';

import { type AutomationLane, type AutomationPoint } from '../../../models/AutomationViewTypes';
import { onRubberBandStart } from '../automationDrag';

const mocks = vi.hoisted(() => ({
    pushUndoEntry: vi.fn(),
}));

vi.mock('#/modules/Command/useCases', () => ({
    getExecutableAppActionEffect: vi.fn(() => null),
    executeUserAppAction: vi.fn(),
    executeAppAction: vi.fn(),
    pushUndoEntry: mocks.pushUndoEntry,
}));

// Coordinate mapping: 10px per beat, y 0..100 → value 1..0.
const coords = {
    getRect: (): DOMRect => new DOMRect(0, 0, 200, 100),
    xToBeat: (x: number): number => x / 10,
    yToValue: (y: number): number => 1 - y / 100,
};

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

const Surface = (): ReactElement => {
    const handleMouseDown = (event: ReactMouseEvent<HTMLDivElement>): void => {
        const lane = automationStore.value?.lanes[0];
        if (!lane) {
            return;
        }
        onRubberBandStart(event, lane, setRubberBand, setSelectedPoints, coords);
    };
    return <div aria-label="lane-surface" onMouseDown={handleMouseDown} />;
};

const storedPoints = (): AutomationPoint[] =>
    automationStore.value?.lanes.find((lane) => lane.id === 'lane-1')?.points ?? [];

describe('automationDrag click-add undo (#4819)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // The lane already holds a point at beat 16, written by an earlier
        // route. The click below lands on that exact beat.
        automationStore.set({
            lanes: [makeLane([{ id: 'existing-16', beat: 16, value: 0.2, curve: 'linear', tension: 0 }])],
        });
    });

    it('undoing a click-added point removes only it, sparing the earlier point at the same beat', () => {
        render(<Surface />);
        const surface = screen.getByLabelText('lane-surface');

        // Click at beat 16, value 0.8.
        fireEvent.mouseDown(surface, { clientX: 160, clientY: 20 });
        fireEvent.mouseUp(window, { clientX: 160, clientY: 20 });

        // Both points coexist at beat 16; the click's point is the one with a
        // freshly minted id.
        const afterAdd = storedPoints();
        expect(afterAdd).toHaveLength(2);
        const clickedId = afterAdd.find((point) => point.id !== 'existing-16')?.id;
        expect(clickedId).toEqual(expect.any(String));
        expect(afterAdd.find((point) => point.id === clickedId)).toMatchObject({ beat: 16, value: 0.8 });

        expect(mocks.pushUndoEntry).toHaveBeenCalledTimes(1);
        const undoFn = mocks.pushUndoEntry.mock.calls[0]?.[1];
        const redoFn = mocks.pushUndoEntry.mock.calls[0]?.[2];

        undoFn!();
        expect(storedPoints()).toEqual([{ id: 'existing-16', beat: 16, value: 0.2, curve: 'linear', tension: 0 }]);

        redoFn!();
        const afterRedo = storedPoints();
        expect(afterRedo).toHaveLength(2);
        expect(afterRedo.find((point) => point.id === 'existing-16')).toMatchObject({ beat: 16, value: 0.2 });
        expect(afterRedo.find((point) => point.id === clickedId)).toMatchObject({ beat: 16, value: 0.8 });

        // The cycle keeps holding: a second undo again spares the earlier point.
        undoFn!();
        expect(storedPoints()).toEqual([{ id: 'existing-16', beat: 16, value: 0.2, curve: 'linear', tension: 0 }]);

        redoFn!();
        expect(storedPoints()).toHaveLength(2);
    });
});
