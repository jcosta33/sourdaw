import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FADER_MAX_GAIN } from '#/utils/audioLevelLaw';

import { createAutomationLane } from '../../../models/Automation';

import type { AutomationStoreState } from '../../../stores/automationStore';

const mocks = vi.hoisted(() => {
    const state: { value: AutomationStoreState | null } = { value: null };

    return {
        state,
        getValue: vi.fn((): AutomationStoreState | null => state.value),
        set: vi.fn((nextState: AutomationStoreState): void => {
            state.value = nextState;
        }),
    };
});

vi.mock('../../../stores/automationStore', () => ({
    automationStore: {
        get value(): AutomationStoreState | null {
            return mocks.getValue();
        },
        set: mocks.set,
    },
}));

const { adjustYZoom } = await import('../adjustYZoom');

describe('adjustYZoom', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.state.value = {
            lanes: [{ ...createAutomationLane('t1', 'gain', 'Gain', 0, 100), id: 'l1' }],
        };
    });

    it('shrinks the view range around its center when zooming in', () => {
        adjustYZoom('l1', 2);

        const lane = mocks.state.value!.lanes[0]!;
        expect(lane.viewMinValue).toBe(10);
        expect(lane.viewMaxValue).toBe(90);
    });

    it('clamps the grown range to the lane bounds when zooming out', () => {
        adjustYZoom('l1', -20);

        const lane = mocks.state.value!.lanes[0]!;
        expect(lane.viewMinValue).toBe(0);
        expect(lane.viewMaxValue).toBe(100);
    });

    it('floors the range at 5% of the full min/max span', () => {
        adjustYZoom('l1', 9.99);

        const lane = mocks.state.value!.lanes[0]!;
        expect(lane.viewMaxValue! - lane.viewMinValue!).toBeCloseTo(5, 5);
    });

    /**
     * A gain lane authored before the fader gained its `+6 dB` of headroom
     * stores `maxValue: 1` and keeps it — the scalar is durable CRDT state a
     * sanitizer must not rewrite. The drawable ceiling is derived instead, and
     * the Y axis has to use the same one the unzoomed row does: bounding the
     * view at the stored `1` would put the axis back at unity on the first
     * zoom gesture and hide every point drawn into the headroom.
     */
    it('zooms a legacy gain lane out to the derived ceiling, not its stored one', () => {
        mocks.state.value = {
            lanes: [{ ...createAutomationLane('t1', 'gain', 'Gain', 0, 1), id: 'l1' }],
        };

        adjustYZoom('l1', -20);

        const lane = mocks.state.value.lanes[0]!;
        expect(lane.viewMinValue).toBe(0);
        expect(lane.viewMaxValue).toBeCloseTo(FADER_MAX_GAIN, 10);
        expect(FADER_MAX_GAIN).toBeGreaterThan(1);
    });

    it('holds a non-gain lane at its own stored ceiling', () => {
        mocks.state.value = {
            lanes: [{ ...createAutomationLane('t1', 'send-bus-1', 'Send', 0, 1), id: 'l1' }],
        };

        adjustYZoom('l1', -20);

        expect(mocks.state.value.lanes[0]!.viewMaxValue).toBe(1);
    });

    it('does nothing when the lane is not found', () => {
        adjustYZoom('missing', 1);
        expect(mocks.set).not.toHaveBeenCalled();
    });

    it('does nothing when the store is unavailable', () => {
        mocks.state.value = null;
        adjustYZoom('l1', 1);
        expect(mocks.set).not.toHaveBeenCalled();
    });
});
