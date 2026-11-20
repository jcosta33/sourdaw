import { type ReactElement, type MouseEvent as ReactMouseEvent } from 'react';

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { automationStore } from '#/modules/Automation/stores';
import { executeUserAppAction } from '#/modules/Command/useCases';

import { type AutomationLane, type AutomationPoint } from '../../../models/AutomationViewTypes';
import { onRubberBandStart } from '../automationDrag';

vi.mock('#/modules/Command/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Command/useCases')>()),
    executeUserAppAction: vi.fn(),
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

describe('automationDrag click-add undo (#4819)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // The lane already holds a point at beat 16, written by an earlier
        // route. The click below lands on that exact beat.
        automationStore.set({
            lanes: [makeLane([{ id: 'existing-16', beat: 16, value: 0.2, curve: 'linear', tension: 0 }])],
        });
    });

    it('dispatches one point insertion when the click lands on an existing beat', () => {
        render(<Surface />);
        const surface = screen.getByLabelText('lane-surface');

        fireEvent.mouseDown(surface, { clientX: 160, clientY: 20 });
        expect(executeUserAppAction).not.toHaveBeenCalled();
        fireEvent.mouseUp(window, { clientX: 160, clientY: 20 });

        expect(executeUserAppAction).toHaveBeenCalledExactlyOnceWith(
            {
                type: 'insertAutomationLanePoints',
                payload: {
                    laneId: 'lane-1',
                    owner: { trackId: 'track-1', parameterId: 'volume' },
                    insertion: { kind: 'point', point: { beat: 16, value: 0.8, curve: 'linear', tension: 0 } },
                },
            },
            expect.objectContaining({ authorizeFirstHandler: expect.any(Function) })
        );
    });
});
