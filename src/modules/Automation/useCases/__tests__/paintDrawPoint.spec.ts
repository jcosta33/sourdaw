import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    snapDrawBeatToGrid: vi.fn((beat: number) => beat),
    flushPendingDrawState: vi.fn(),
}));

vi.mock('../snapDrawBeatToGrid', () => ({
    snapDrawBeatToGrid: mocks.snapDrawBeatToGrid,
}));

vi.mock('../flushPendingDrawState', () => ({
    flushPendingDrawState: mocks.flushPendingDrawState,
}));

import { automationStore, type AutomationStoreState } from '../../stores/automationStore';
import { automationDrawModeState } from '../automationDrawMode';
import { paintDrawPoint } from '../paintDrawPoint';

function makeStoreState(): AutomationStoreState {
    return {
        lanes: [
            {
                id: 'lane-1',
                trackId: 'track-1',
                parameterId: 'gain',
                parameterName: 'Gain',
                points: [],
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
        initialValue: null,
        drawnBeats: new Set<number>(),
        previousPoints: [],
        pendingState: null,
        rafId: null,
        ...overrides,
    };
}

describe('paintDrawPoint', () => {
    beforeEach(() => {
        automationDrawModeState.activeSession = null;
        automationStore.set(makeStoreState());
        vi.clearAllMocks();
        mocks.snapDrawBeatToGrid.mockImplementation((beat: number) => beat);
        vi.stubGlobal(
            'requestAnimationFrame',
            vi.fn(() => 42)
        );
    });

    afterEach(() => {
        automationDrawModeState.activeSession = null;
        vi.unstubAllGlobals();
    });

    it('is a no-op when no draw session is active', () => {
        automationDrawModeState.activeSession = null;
        const before = automationStore.value;

        paintDrawPoint(1, 0.5);

        // Store unchanged.
        expect(automationStore.value).toBe(before);
    });

    it('snaps the beat to the grid resolution before painting', () => {
        startSession();
        mocks.snapDrawBeatToGrid.mockReturnValue(2.0);

        paintDrawPoint(1.9, 0.5);

        expect(mocks.snapDrawBeatToGrid).toHaveBeenCalledWith(1.9, 0.25);
        const lane = automationDrawModeState.activeSession!.pendingState!.lanes.find((l) => l.id === 'lane-1')!;
        expect(lane.points[0]?.beat).toBe(2.0);
    });

    it('paints a new point clamped to the lane min/max range', () => {
        startSession();

        paintDrawPoint(1, 1.5); // above maxValue 1.0

        const lane = automationDrawModeState.activeSession!.pendingState!.lanes.find((l) => l.id === 'lane-1')!;
        expect(lane.points).toHaveLength(1);
        expect(lane.points[0]?.value).toBe(1.0); // clamped to max
    });

    it('clamps below the lane minimum', () => {
        startSession();

        paintDrawPoint(1, -0.5); // below minValue 0

        const lane = automationDrawModeState.activeSession!.pendingState!.lanes.find((l) => l.id === 'lane-1')!;
        expect(lane.points[0]?.value).toBe(0); // clamped to min
    });

    it('replaces an existing point at the same snapped beat', () => {
        startSession();

        paintDrawPoint(1, 0.3);
        paintDrawPoint(1, 0.7);

        const lane = automationDrawModeState.activeSession!.pendingState!.lanes.find((l) => l.id === 'lane-1')!;
        // Only one point — the second call replaced the first.
        expect(lane.points).toHaveLength(1);
        expect(lane.points[0]?.value).toBe(0.7);
    });

    it('keeps points sorted by beat after painting', () => {
        startSession();

        paintDrawPoint(3, 0.5);
        paintDrawPoint(1, 0.5);
        paintDrawPoint(2, 0.5);

        const lane = automationDrawModeState.activeSession!.pendingState!.lanes.find((l) => l.id === 'lane-1')!;
        expect(lane.points.map((p) => p.beat)).toEqual([1, 2, 3]);
    });

    it('does not modify other lanes', () => {
        startSession();

        paintDrawPoint(1, 0.5);

        const lane2 = automationDrawModeState.activeSession!.pendingState!.lanes.find((l) => l.id === 'lane-2')!;
        expect(lane2.points).toHaveLength(0);
    });

    it('constrainHorizontal mode uses the initial value instead of the paint value', () => {
        startSession({ constrainHorizontal: true });

        // First paint captures initialValue = 0.4.
        paintDrawPoint(1, 0.4);
        // Second paint at a different beat with a different value — constrained to 0.4.
        paintDrawPoint(2, 0.9);

        const lane = automationDrawModeState.activeSession!.pendingState!.lanes.find((l) => l.id === 'lane-1')!;
        expect(lane.points).toHaveLength(2);
        expect(lane.points[0]?.value).toBe(0.4);
        expect(lane.points[1]?.value).toBe(0.4); // constrained, not 0.9
    });

    it('schedules a flush via requestAnimationFrame on first paint only', () => {
        startSession();

        paintDrawPoint(1, 0.5);
        expect(requestAnimationFrame).toHaveBeenCalledTimes(1);

        // Second paint — RAF already scheduled, no new one.
        paintDrawPoint(2, 0.5);
        expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
    });

    it('adds the snapped beat to drawnBeats', () => {
        startSession();
        mocks.snapDrawBeatToGrid.mockReturnValue(3.5);

        paintDrawPoint(3, 0.5);

        expect(automationDrawModeState.activeSession!.drawnBeats.has(3.5)).toBe(true);
    });
});
