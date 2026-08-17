import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    pushUndoEntry: vi.fn(),
}));

vi.mock('#/modules/Command/useCases', () => ({
    pushUndoEntry: mocks.pushUndoEntry,
}));

import { automationStore, type AutomationStoreState } from '../../stores/automationStore';
import { automationDrawModeState } from '../automationDrawMode';
import { beginDrawSession } from '../beginDrawSession';
import { cancelDrawSession } from '../cancelDrawSession';
import { paintDrawPoint } from '../paintDrawPoint';

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

describe('cancelDrawSession', () => {
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

        expect(() => cancelDrawSession()).not.toThrow();
        expect(mocks.pushUndoEntry).not.toHaveBeenCalled();
    });

    it('never registers an undo entry — cancel reverts, it does not commit', () => {
        startSession();

        cancelDrawSession();

        expect(mocks.pushUndoEntry).not.toHaveBeenCalled();
    });

    it('cancels the pending animation frame when rafId is set', () => {
        const cancelSpy = vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => undefined);
        startSession({ rafId: 42 });

        cancelDrawSession();

        expect(cancelSpy).toHaveBeenCalledWith(42);
        cancelSpy.mockRestore();
    });

    it('restores the lane to its pre-session previousPoints, discarding painted points', () => {
        startSession();
        // Simulate the store already having been mutated by paintDrawPoint calls
        // during the drag (what onMove does live, before cancel runs).
        automationStore.value!.lanes[0]!.points = [
            { beat: 0, value: 0.3, curve: 'step', tension: 0 },
            { beat: 1, value: 0.7, curve: 'step', tension: 0 },
            { beat: 2, value: 0.9, curve: 'step', tension: 0 },
        ];

        cancelDrawSession();

        const lane = automationStore.value!.lanes.find((l) => l.id === 'lane-1')!;
        expect(lane.points).toHaveLength(1);
        expect(lane.points[0]?.beat).toBe(0);
        expect(lane.points[0]?.value).toBeCloseTo(0.3, 5);
    });

    it('does not modify other lanes', () => {
        startSession();

        cancelDrawSession();

        const lane2 = automationStore.value!.lanes.find((l) => l.id === 'lane-2')!;
        expect(lane2.points).toHaveLength(0);
    });

    it('clears the pending state and the active session', () => {
        startSession({ pendingState: { lanes: [] } });

        cancelDrawSession();

        expect(automationDrawModeState.activeSession).toBeNull();
    });

    it('the rAF it cancels never fires — no store write happens after cancel resolves', () => {
        // Real timers: paintDrawPoint schedules a genuine requestAnimationFrame,
        // the same one the live gesture would leave pending across Escape.
        beginDrawSession('lane-1', 0.25, false);
        paintDrawPoint(1, 0.75);
        expect(automationDrawModeState.activeSession?.rafId).not.toBeNull();
        expect(automationDrawModeState.activeSession?.pendingState).not.toBeNull();

        cancelDrawSession();

        return new Promise<void>((resolve) => {
            requestAnimationFrame(() => {
                // If flushPendingDrawState had still fired, the lane would show the
                // painted beat-1 point instead of the untouched original two points.
                const lane = automationStore.value!.lanes.find((l) => l.id === 'lane-1')!;
                expect(lane.points).toHaveLength(2);
                expect(lane.points.some((point) => point.beat === 1)).toBe(false);
                resolve();
            });
        });
    });

    it('a subsequent beginDrawSession starts clean after a cancel', () => {
        beginDrawSession('lane-1', 0.25, false);
        paintDrawPoint(1, 0.75);
        cancelDrawSession();

        beginDrawSession('lane-1', 0.5, true);

        const session = automationDrawModeState.activeSession;
        expect(session).not.toBeNull();
        expect(session?.gridResolution).toBe(0.5);
        expect(session?.constrainHorizontal).toBe(true);
        expect(session?.pendingState).toBeNull();
        expect(session?.rafId).toBeNull();
        expect(session?.drawnBeats).toEqual(new Set());
        expect(session?.previousPoints).toHaveLength(2);
    });
});
