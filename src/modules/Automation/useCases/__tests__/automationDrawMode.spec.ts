import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { FADER_MAX_GAIN } from '#/utils/audioLevelLaw';

import { createAutomationLane, type AutomationLane, type AutomationPoint } from '../../models/Automation';
import { automationStore } from '../../stores/automationStore';
import { beginDrawSession } from '../beginDrawSession';
import { endDrawSession } from '../endDrawSession';
import { isDrawSessionActive } from '../isDrawSessionActive';
import { paintDrawPoint } from '../paintDrawPoint';

const { mocks } = vi.hoisted(() => ({
    mocks: {
        pushUndoEntry: vi.fn<(label: string, undoFn: () => void, redoFn: () => void) => void>(),
    },
}));

vi.mock('#/modules/Command/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Command/useCases')>();
    return {
        ...actual,
        pushUndoEntry: mocks.pushUndoEntry,
    };
});

type CreateDrawLaneInput = {
    points?: AutomationPoint[];
    minValue?: number;
    maxValue?: number;
};

function createDrawLane({ points = [], minValue = 0, maxValue = 1 }: CreateDrawLaneInput = {}): AutomationLane {
    return {
        ...createAutomationLane('t1', 'gain', 'Gain', minValue, maxValue),
        id: 'lane-draw',
        points,
    };
}

function getDrawLanePoints(): AutomationPoint[] {
    return automationStore.value?.lanes.find((lane) => lane.id === 'lane-draw')?.points ?? [];
}

function stubAnimationFrame() {
    let pendingCallback: FrameRequestCallback | null = null;
    const requestAnimationFrameMock = vi.fn((callback: FrameRequestCallback): number => {
        pendingCallback = callback;
        return 101;
    });
    const cancelAnimationFrameMock = vi.fn();
    vi.stubGlobal('requestAnimationFrame', requestAnimationFrameMock);
    vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrameMock);

    return {
        requestAnimationFrameMock,
        cancelAnimationFrameMock,
        flushFrame: () => {
            if (pendingCallback === null) {
                throw new Error('No animation frame is pending.');
            }
            const callback = pendingCallback;
            pendingCallback = null;
            callback(0);
        },
    };
}

describe('automationDrawMode', () => {
    beforeEach(() => {
        automationStore.set({ lanes: [] });
        mocks.pushUndoEntry.mockReset();
    });

    afterEach(() => {
        if (isDrawSessionActive()) {
            endDrawSession();
        }
        vi.unstubAllGlobals();
        automationStore.set({ lanes: [] });
        mocks.pushUndoEntry.mockReset();
    });

    it('should accumulate fast paints and flush pending lane state once per animation frame', () => {
        const animationFrame = stubAnimationFrame();
        const previousPoints: AutomationPoint[] = [{ beat: 0, value: 0.25, curve: 'linear', tension: 0 }];
        automationStore.set({ lanes: [createDrawLane({ points: previousPoints })] });

        beginDrawSession('lane-draw', 0.5, false);
        paintDrawPoint(1.1, 0.2);
        paintDrawPoint(1.6, 0.8);

        expect(isDrawSessionActive()).toBe(true);
        expect(animationFrame.requestAnimationFrameMock).toHaveBeenCalledTimes(1);
        expect(getDrawLanePoints()).toEqual(previousPoints);

        animationFrame.flushFrame();

        expect(getDrawLanePoints()).toEqual([
            { beat: 0, value: 0.25, curve: 'linear', tension: 0 },
            { beat: 1, value: 0.2, curve: 'step', tension: 0 },
            { beat: 1.5, value: 0.8, curve: 'step', tension: 0 },
        ]);
    });

    it('should cancel pending frame, flush final state, clear session, and register undo/redo', () => {
        const animationFrame = stubAnimationFrame();
        const previousPoints: AutomationPoint[] = [{ beat: 0, value: 0.25, curve: 'linear', tension: 0 }];
        automationStore.set({ lanes: [createDrawLane({ points: previousPoints })] });

        beginDrawSession('lane-draw', 0.25, false);
        paintDrawPoint(2.12, 2);

        expect(getDrawLanePoints()).toEqual(previousPoints);

        endDrawSession();

        const currentPoints = [
            { beat: 0, value: 0.25, curve: 'linear', tension: 0 },
            { beat: 2, value: FADER_MAX_GAIN, curve: 'step', tension: 0 },
        ];
        expect(animationFrame.cancelAnimationFrameMock).toHaveBeenCalledWith(101);
        expect(isDrawSessionActive()).toBe(false);
        expect(getDrawLanePoints()).toEqual(currentPoints);
        expect(mocks.pushUndoEntry).toHaveBeenCalledTimes(1);

        const undoEntry = mocks.pushUndoEntry.mock.calls.at(0);
        expect(undoEntry).toBeDefined();
        if (undoEntry === undefined) {
            return;
        }
        const [label, undo, redo] = undoEntry;
        expect(label).toBe('Draw automation');

        undo();
        expect(getDrawLanePoints()).toEqual(previousPoints);

        redo();
        expect(getDrawLanePoints()).toEqual(currentPoints);
    });

    it('should paint a finite raw beat when gridResolution is zero', () => {
        stubAnimationFrame();
        automationStore.set({ lanes: [createDrawLane()] });

        beginDrawSession('lane-draw', 0, false);
        paintDrawPoint(3.7, 0.5);
        endDrawSession();

        expect(getDrawLanePoints()).toEqual([{ beat: 3.7, value: 0.5, curve: 'step', tension: 0 }]);
    });

    it('should paint a finite raw beat when gridResolution is non-finite', () => {
        stubAnimationFrame();
        automationStore.set({ lanes: [createDrawLane()] });

        beginDrawSession('lane-draw', Number.POSITIVE_INFINITY, false);
        paintDrawPoint(4.2, 0.75);
        endDrawSession();

        expect(getDrawLanePoints()).toEqual([{ beat: 4.2, value: 0.75, curve: 'step', tension: 0 }]);
    });

    it('should constrain to the initial value and clamp painted values to the lane range', () => {
        const animationFrame = stubAnimationFrame();
        automationStore.set({ lanes: [createDrawLane({ minValue: -0.5, maxValue: 0.5 })] });

        beginDrawSession('lane-draw', 1, true);
        paintDrawPoint(1.1, 2);
        paintDrawPoint(2.1, -0.25);

        animationFrame.flushFrame();

        expect(getDrawLanePoints()).toEqual([
            { beat: 1, value: 0.5, curve: 'step', tension: 0 },
            { beat: 2, value: 0.5, curve: 'step', tension: 0 },
        ]);
    });
});
