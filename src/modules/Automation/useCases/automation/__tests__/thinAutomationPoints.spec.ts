import { describe, it, expect, beforeEach } from 'vitest';

import { type AutomationLane } from '../../../models/Automation';
import { automationStore } from '../../../stores/automationStore';
import { thinAutomationPoints } from '../thinAutomationPoints';

// These tests exercise the REAL dependency `simplifyAutomationPoints`
// (../../services/automationPointAlgorithms) — the function `thinAutomationPoints`
// actually imports — rather than a mock of an unrelated `rdpSimplify`. The prior
// spec mocked `rdpSimplify` from Arrangement, which production code never calls, so
// the mock was inert and the suite passed without observing any real thinning.

function makeLane(points: AutomationLane['points']): AutomationLane {
    return {
        id: 'lane-1',
        trackId: 't1',
        parameterId: 'p',
        parameterName: 'P',
        points,
        objects: [],
        visible: true,
        enabled: true,
        collapsed: false,
        minValue: 0,
        maxValue: 1,
    };
}

describe('thinAutomationPoints', () => {
    beforeEach(() => {
        automationStore.set({ lanes: [] });
    });

    it('does not write when the automation store is null', () => {
        automationStore.set(null);

        thinAutomationPoints('lane-1');

        expect(automationStore.value).toBeNull();
    });

    it('leaves a lane untouched when it has two or fewer points', () => {
        const points = [
            { beat: 0, value: 0, curve: 'linear' as const, tension: 0 },
            { beat: 4, value: 1, curve: 'linear' as const, tension: 0 },
        ];
        automationStore.set({ lanes: [makeLane(points)] });

        thinAutomationPoints('lane-1');

        expect(automationStore.value?.lanes[0]?.points).toEqual(points);
    });

    it('drops a redundant collinear midpoint via the real simplify algorithm', () => {
        automationStore.set({
            lanes: [
                makeLane([
                    { beat: 0, value: 0, curve: 'linear', tension: 0 },
                    // Exactly on the line from (0,0) to (4,1): perpendicular distance 0.
                    { beat: 2, value: 0.5, curve: 'linear', tension: 0 },
                    { beat: 4, value: 1, curve: 'linear', tension: 0 },
                ]),
            ],
        });

        thinAutomationPoints('lane-1');

        const result = automationStore.value?.lanes[0]?.points;
        expect(result).toEqual([
            { beat: 0, value: 0, curve: 'linear', tension: 0 },
            { beat: 4, value: 1, curve: 'linear', tension: 0 },
        ]);
    });

    it('keeps a midpoint whose deviation exceeds the tolerance', () => {
        const points = [
            { beat: 0, value: 0, curve: 'linear' as const, tension: 0 },
            // Far off the (0,0)->(4,1) line — must survive a tight tolerance.
            { beat: 2, value: 1, curve: 'linear' as const, tension: 0 },
            { beat: 4, value: 0, curve: 'linear' as const, tension: 0 },
        ];
        automationStore.set({ lanes: [makeLane(points)] });

        thinAutomationPoints('lane-1', 0.01);

        expect(automationStore.value?.lanes[0]?.points).toEqual(points);
    });

    it('passes the tolerance through to the real algorithm so a wide tolerance thins the midpoint', () => {
        const apex = { beat: 2, value: 1, curve: 'linear' as const, tension: 0 };
        automationStore.set({
            lanes: [
                makeLane([
                    { beat: 0, value: 0, curve: 'linear', tension: 0 },
                    apex,
                    { beat: 4, value: 0, curve: 'linear', tension: 0 },
                ]),
            ],
        });

        // The apex sits a perpendicular distance of 1.0 from the (0,0)->(4,0) chord;
        // a tolerance above 1.0 collapses it, proving tolerance reaches the algorithm.
        thinAutomationPoints('lane-1', 2);

        expect(automationStore.value?.lanes[0]?.points).toEqual([
            { beat: 0, value: 0, curve: 'linear', tension: 0 },
            { beat: 4, value: 0, curve: 'linear', tension: 0 },
        ]);
    });

    it('leaves other lanes untouched', () => {
        const otherPoints = [
            { beat: 0, value: 0, curve: 'linear' as const, tension: 0 },
            { beat: 2, value: 0.5, curve: 'linear' as const, tension: 0 },
            { beat: 4, value: 1, curve: 'linear' as const, tension: 0 },
        ];
        automationStore.set({
            lanes: [
                makeLane([
                    { beat: 0, value: 0, curve: 'linear', tension: 0 },
                    { beat: 2, value: 0.5, curve: 'linear', tension: 0 },
                    { beat: 4, value: 1, curve: 'linear', tension: 0 },
                ]),
                { ...makeLane(otherPoints), id: 'lane-2' },
            ],
        });

        thinAutomationPoints('lane-1');

        expect(automationStore.value?.lanes[1]?.points).toEqual(otherPoints);
    });
});
