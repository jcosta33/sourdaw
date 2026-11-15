import { describe, it, expect, vi, beforeEach } from 'vitest';

import { automationStore } from '#/modules/Automation/stores';
import { getAutomationValueAtBeat } from '#/modules/Automation/useCases';

import { type AutomationLane, type AutomationPoint } from '../../../models/AutomationViewTypes';
import { insertAutomationPointPreservingShape } from '../automationDrag';

const mocks = vi.hoisted(() => ({
    pushUndoEntry: vi.fn<(label: string, undo: () => void, redo: () => void) => void>(),
}));

vi.mock('#/modules/Command/useCases', () => ({
    commitUndoEntry: vi.fn(),
    createUndoEntry: vi.fn(),
    getExecutableAppActionEffect: vi.fn(() => null),
    executeUserAppAction: vi.fn(),
    executeAppAction: vi.fn(),
    pushUndoEntry: mocks.pushUndoEntry,
}));

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

const storedPoints = (): AutomationPoint[] =>
    automationStore.value?.lanes.find((lane) => lane.id === 'lane-1')?.points ?? [];

/** Beats on both sides of every insert below, including the segment ends and just past the insert. */
const PROBE_BEATS = [0, 0.5, 1, 2.25, 2.99, 3, 3.01, 4.5, 6, 7.75, 8, 9, 12];

const sampleLane = (): number[] => PROBE_BEATS.map((beat) => getAutomationValueAtBeat('lane-1', beat) ?? Number.NaN);

const expectSameSamples = (before: number[], after: number[]): void => {
    expect(after).toHaveLength(before.length);
    for (const [index, value] of after.entries()) {
        expect(value).toBeCloseTo(before[index] ?? Number.NaN, 12);
    }
};

describe('insertAutomationPointPreservingShape', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it.each<{ name: string; points: AutomationPoint[]; beat: number }>([
        {
            name: 'inside a step segment',
            points: [
                { id: 'a', beat: 0, value: 0.2, curve: 'step', tension: 0 },
                { id: 'b', beat: 8, value: 0.9, curve: 'linear', tension: 0 },
            ],
            beat: 3,
        },
        {
            name: 'inside a linear segment',
            points: [
                { id: 'a', beat: 0, value: 0.1, curve: 'linear', tension: 0 },
                { id: 'b', beat: 8, value: 0.9, curve: 'linear', tension: 0 },
            ],
            beat: 3,
        },
        {
            name: 'after the last point of a lane ending on an exponential segment',
            points: [
                { id: 'a', beat: 0, value: 0.1, curve: 'exponential', tension: 0.6 },
                { id: 'b', beat: 2, value: 0.7, curve: 'exponential', tension: 0.6 },
            ],
            beat: 3,
        },
        {
            name: 'before the first point',
            points: [
                { id: 'a', beat: 4, value: 0.3, curve: 'bezier', tension: 0, cp1: { x: 0.1, y: 0.9 } },
                { id: 'b', beat: 8, value: 0.6, curve: 'linear', tension: 0 },
            ],
            beat: 3,
        },
    ])('adds a point $name and plays the same values on both sides', ({ points, beat }) => {
        automationStore.set({ lanes: [makeLane(points)] });
        const before = sampleLane();

        expect(insertAutomationPointPreservingShape('lane-1', beat)).toBe(true);

        expect(storedPoints()).toHaveLength(points.length + 1);
        expect(storedPoints().some((point) => point.beat === beat)).toBe(true);
        expectSameSamples(before, sampleLane());
        expect(mocks.pushUndoEntry).toHaveBeenCalledTimes(1);
    });

    it.each<{ name: string; points: AutomationPoint[] }>([
        {
            name: 'a bezier segment with authored controls',
            points: [
                {
                    id: 'a',
                    beat: 0,
                    value: 0.1,
                    curve: 'bezier',
                    tension: 0,
                    cp1: { x: 0.2, y: 0.95 },
                    cp2: { x: 0.7, y: 0.05 },
                },
                { id: 'b', beat: 8, value: 0.9, curve: 'linear', tension: 0 },
            ],
        },
        {
            name: 'an exponential segment',
            points: [
                { id: 'a', beat: 0, value: 0.1, curve: 'exponential', tension: 0.6 },
                { id: 'b', beat: 8, value: 0.9, curve: 'linear', tension: 0 },
            ],
        },
        {
            name: 'a stairs segment',
            points: [
                { id: 'a', beat: 0, value: 0.1, curve: 'stairs', tension: 0, stairSteps: 4 },
                { id: 'b', beat: 8, value: 0.9, curve: 'linear', tension: 0 },
            ],
        },
        {
            name: 'a linear segment that a smooth segment reads as its neighbour',
            points: [
                { id: 'a', beat: 0, value: 0.1, curve: 'linear', tension: 0 },
                { id: 'b', beat: 8, value: 0.9, curve: 'smooth', tension: 0 },
                { id: 'c', beat: 12, value: 0.2, curve: 'linear', tension: 0 },
            ],
        },
    ])('refuses a point inside $name it cannot split exactly', ({ points }) => {
        automationStore.set({ lanes: [makeLane(points)] });
        const before = sampleLane();

        expect(insertAutomationPointPreservingShape('lane-1', 3)).toBe(false);

        expect(storedPoints()).toEqual(points);
        expectSameSamples(before, sampleLane());
        expect(mocks.pushUndoEntry).not.toHaveBeenCalled();
    });

    it('removes exactly the inserted point on undo', () => {
        const points: AutomationPoint[] = [
            { id: 'a', beat: 0, value: 0.2, curve: 'step', tension: 0 },
            { id: 'b', beat: 8, value: 0.9, curve: 'linear', tension: 0 },
        ];
        automationStore.set({ lanes: [makeLane(points)] });

        insertAutomationPointPreservingShape('lane-1', 3);
        const [entry] = mocks.pushUndoEntry.mock.calls;
        expect(entry).toBeDefined();
        entry?.[1]();

        expect(storedPoints()).toEqual(points);
    });
});
