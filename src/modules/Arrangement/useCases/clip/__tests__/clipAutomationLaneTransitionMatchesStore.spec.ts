import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type ClipAutomationLaneSnapshot } from '#/utils/handlerContract';

const mocks = vi.hoisted(() => ({
    getAutomationLanes: vi.fn<() => ClipAutomationLaneSnapshot[]>(),
    readClipScopedAutomationLanes: vi.fn<() => ClipAutomationLaneSnapshot[]>(),
}));

vi.mock('#/modules/Automation/useCases', () => ({ getAutomationLanes: mocks.getAutomationLanes }));
vi.mock('../readClipScopedAutomationLanes', () => ({
    readClipScopedAutomationLanes: mocks.readClipScopedAutomationLanes,
}));

const { clipAutomationLaneTransitionMatchesStore } = await import('../clipAutomationLaneTransitionMatchesStore');

function lane(): ClipAutomationLaneSnapshot {
    return {
        id: 'lane-1',
        trackId: 'track-1',
        clipId: 'clip-1',
        parameterId: 'gain',
        parameterName: 'Gain',
        points: [
            { id: 'point-1', beat: 0, value: 0.5, curve: 'linear', tension: 0 },
            { id: 'point-2', beat: 1, value: 0.75, curve: 'linear', tension: 0 },
        ],
        objects: [],
        visible: true,
        enabled: true,
        collapsed: false,
        minValue: 0,
        maxValue: 1,
    };
}

function setLiveLanes(lanes: readonly ClipAutomationLaneSnapshot[]): void {
    const clonedLanes = structuredClone(lanes);
    mocks.getAutomationLanes.mockReturnValue(clonedLanes);
    mocks.readClipScopedAutomationLanes.mockReturnValue(clonedLanes);
}

describe('clipAutomationLaneTransitionMatchesStore', () => {
    beforeEach(() => {
        mocks.getAutomationLanes.mockReturnValue([]);
        mocks.readClipScopedAutomationLanes.mockReturnValue([]);
    });

    it('accepts the same lane rebuilt with different object-key insertion order', () => {
        const expected = lane();
        const { id, ...leadingFields } = expected;
        setLiveLanes([{ ...leadingFields, id }]);

        expect(clipAutomationLaneTransitionMatchesStore(['clip-1'], [expected], [])).toBe(true);
    });

    it('rejects a changed point and changed point order', () => {
        const expected = lane();
        setLiveLanes([{ ...expected, points: [{ ...expected.points[0]!, value: 0.9 }, expected.points[1]!] }]);
        expect(clipAutomationLaneTransitionMatchesStore(['clip-1'], [expected], [])).toBe(false);

        setLiveLanes([{ ...expected, points: [expected.points[1]!, expected.points[0]!] }]);
        expect(clipAutomationLaneTransitionMatchesStore(['clip-1'], [expected], [])).toBe(false);
    });
});
