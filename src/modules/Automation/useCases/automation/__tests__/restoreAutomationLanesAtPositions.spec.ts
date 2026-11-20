import { afterEach, describe, expect, it } from 'vitest';

import { automationStore } from '../../../stores/automationStore';
import { restoreAutomationLanesAtPositions } from '../restoreAutomationLanesAtPositions';

import type { AutomationLane } from '../../../models/Automation';

function createLane(id: string): AutomationLane {
    return {
        id,
        trackId: 'track-1',
        parameterId: `parameter-${id}`,
        parameterName: `Parameter ${id}`,
        points: [],
        objects: [],
        visible: true,
        enabled: true,
        collapsed: false,
        minValue: 0,
        maxValue: 1,
    };
}

function laneIds(): string[] {
    return automationStore.value!.lanes.map((lane) => lane.id);
}

describe('restoreAutomationLanesAtPositions', () => {
    afterEach(() => {
        automationStore.set({ lanes: [] });
    });

    it('puts lanes back at their captured indexes, whatever order the entries arrive in', () => {
        automationStore.set({ lanes: [createLane('a'), createLane('c'), createLane('e')] });

        const written = restoreAutomationLanesAtPositions([
            { index: 3, lane: createLane('d') },
            { index: 1, lane: createLane('b') },
        ]);

        expect(written).toBe(true);
        expect(laneIds()).toEqual(['a', 'b', 'c', 'd', 'e']);
    });

    it('appends an entry whose index is past the end', () => {
        automationStore.set({ lanes: [createLane('a')] });

        expect(restoreAutomationLanesAtPositions([{ index: 7, lane: createLane('z') }])).toBe(true);
        expect(laneIds()).toEqual(['a', 'z']);
    });

    it.each([
        { label: 'a live lane id', entries: [{ index: 0, lane: createLane('a') }] },
        {
            label: 'a duplicated id',
            entries: [
                { index: 0, lane: createLane('b') },
                { index: 1, lane: createLane('b') },
            ],
        },
        { label: 'a negative index', entries: [{ index: -1, lane: createLane('b') }] },
        { label: 'a fractional index', entries: [{ index: 0.5, lane: createLane('b') }] },
        { label: 'an inexact lane', entries: [{ index: 0, lane: { id: 'b' } }] },
    ])('writes nothing and refuses $label', ({ entries }) => {
        automationStore.set({ lanes: [createLane('a')] });

        expect(restoreAutomationLanesAtPositions([{ index: 0, lane: createLane('ok') }, ...entries])).toBe(false);
        expect(laneIds()).toEqual(['a']);
    });
});
