import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    pushUndoEntry: vi.fn(),
    flushPendingDrawState: vi.fn(),
}));

vi.mock('#/modules/Command/useCases', () => ({
    pushUndoEntry: mocks.pushUndoEntry,
}));

vi.mock('../flushPendingDrawState', () => ({
    flushPendingDrawState: mocks.flushPendingDrawState,
}));

import { automationStore, type AutomationStoreState } from '../../stores/automationStore';
import { automationDrawModeState } from '../automationDrawMode';
import { endDrawSession } from '../endDrawSession';

function makeStoreState(): AutomationStoreState {
    return {
        lanes: [
            {
                id: 'lane-1',
                trackId: 'track-1',
                parameterId: 'gain',
                parameterName: 'Gain',
                points: [
                    { beat: 0, value: 0.5, curve: 'step', tension: 0 },
                    { beat: 2, value: 0.9, curve: 'step', tension: 0 },
                ],
                minValue: 0,
                maxValue: 1,
                objects: [],
                visible: true,
                enabled: true,
                collapsed: false,
            },
            {
                id: 'lane-2',
                trackId: 'track-1',
                parameterId: 'pan',
                parameterName: 'Pan',
                points: [],
                minValue: -1,
                maxValue: 1,
                objects: [],
                visible: true,
                enabled: true,
                collapsed: false,
            },
        ],
    };
}

function startSession(overrides?: Partial<typeof automationDrawModeState.activeSession>) {
    automationDrawModeState.activeSession = {
        laneId: 'lane-1',
        gridResolution: 0.25,
        constrainHorizontal: false,
        initialValue: 0.5,
        drawnBeats: new Set([0, 2]),
        previousPoints: [{ beat: 0, value: 0.3, curve: 'step', tension: 0 }],
        pendingState: null,
        rafId: null,
        ...overrides,
    };
}

describe('endDrawSession', () => {
    beforeEach(() => {
        automationDrawModeState.activeSession = null;
        automationStore.set(makeStoreState());
        vi.clearAllMocks();
    });

    afterEach(() => {
        automationDrawModeState.activeSession = null;
    });

    it('is a no-op when no session is active', () => {
        automationDrawModeState.activeSession = null;

        endDrawSession();

        expect(mocks.pushUndoEntry).not.toHaveBeenCalled();
        expect(mocks.flushPendingDrawState).not.toHaveBeenCalled();
    });

    it('flushes pending draw state before registering undo', () => {
        startSession();

        endDrawSession();

        expect(mocks.flushPendingDrawState).toHaveBeenCalledTimes(1);
    });

    it('cancels the pending animation frame when rafId is set', () => {
        const cancelSpy = vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => undefined);
        startSession({ rafId: 42 });

        endDrawSession();

        expect(cancelSpy).toHaveBeenCalledWith(42);
        cancelSpy.mockRestore();
    });

    it('does not call cancelAnimationFrame when rafId is null', () => {
        const cancelSpy = vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => undefined);
        startSession({ rafId: null });

        endDrawSession();

        expect(cancelSpy).not.toHaveBeenCalled();
        cancelSpy.mockRestore();
    });

    it('registers an undo entry with label "Draw automation" and undo/redo callbacks', () => {
        startSession();

        endDrawSession();

        expect(mocks.pushUndoEntry).toHaveBeenCalledTimes(1);
        const [label, undoFn, redoFn] = mocks.pushUndoEntry.mock.calls[0]!;
        expect(label).toBe('Draw automation');
        expect(typeof undoFn).toBe('function');
        expect(typeof redoFn).toBe('function');
    });

    it('undo callback restores the previousPoints snapshot to the lane', () => {
        startSession();

        endDrawSession();

        const [, undoFn] = mocks.pushUndoEntry.mock.calls[0]!;
        // Mutate current lane points to verify undo overwrites them.
        automationStore.value!.lanes[0]!.points = [{ beat: 5, value: 1, curve: 'step', tension: 0 }];
        undoFn();

        const lane = automationStore.value!.lanes.find((l) => l.id === 'lane-1')!;
        // previousPoints had 1 point at beat 0 value 0.3.
        expect(lane.points).toHaveLength(1);
        expect(lane.points[0]?.beat).toBe(0);
        expect(lane.points[0]?.value).toBeCloseTo(0.3, 5);
    });

    it('redo callback restores the currentPoints snapshot to the lane', () => {
        startSession();

        endDrawSession();

        const [, , redoFn] = mocks.pushUndoEntry.mock.calls[0]!;
        // At endDrawSession time, the lane had 2 points (beat 0 value 0.5, beat 2 value 0.9).
        redoFn();

        const lane = automationStore.value!.lanes.find((l) => l.id === 'lane-1')!;
        expect(lane.points).toHaveLength(2);
        expect(lane.points[0]?.value).toBeCloseTo(0.5, 5);
        expect(lane.points[1]?.value).toBeCloseTo(0.9, 5);
    });

    it('undo does not modify other lanes', () => {
        startSession();

        endDrawSession();

        const [, undoFn] = mocks.pushUndoEntry.mock.calls[0]!;
        undoFn();

        const lane2 = automationStore.value!.lanes.find((l) => l.id === 'lane-2')!;
        expect(lane2.points).toHaveLength(0);
    });

    it('clears the active session after registering undo', () => {
        startSession();

        endDrawSession();

        expect(automationDrawModeState.activeSession).toBeNull();
    });
});
