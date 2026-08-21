import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FADER_MAX_GAIN } from '#/utils/audioLevelLaw';

import { createAutomationLane } from '../../../models/Automation';
import { automationStore } from '../../../stores/automationStore';
import { automationDrawModeState } from '../../automationDrawMode';
import { beginDrawSession } from '../../beginDrawSession';
import { paintDrawPoint } from '../../paintDrawPoint';
import { addAutomationLane } from '../addAutomationLane';
import { setAutomationParameterRangeResolver } from '../automationParameterRangeDependencies';

describe('addAutomationLane', () => {
    beforeEach(() => {
        setAutomationParameterRangeResolver(null);
        automationStore.set({ lanes: [] });
    });

    afterEach(() => {
        setAutomationParameterRangeResolver(null);
    });

    it.each([
        ['gain', 0, FADER_MAX_GAIN],
        ['pan', -1, 1],
    ])('creates a %s lane with its canonical normalized bounds', (parameterId, expectedMin, expectedMax) => {
        addAutomationLane('track-1', parameterId, parameterId === 'gain' ? 'Gain' : 'Pan');

        expect(automationStore.value?.lanes).toEqual([
            expect.objectContaining({
                trackId: 'track-1',
                parameterId,
                minValue: expectedMin,
                maxValue: expectedMax,
            }),
        ]);
    });

    it('lets a painted gain point travel above 1.0 up to the fader ceiling, and still rejects past it', () => {
        addAutomationLane('track-1', 'gain', 'Gain');
        const laneId = automationStore.value!.lanes[0]!.id;

        vi.stubGlobal(
            'requestAnimationFrame',
            vi.fn(() => 1)
        );
        try {
            beginDrawSession(laneId, 0.25, false);

            // Above unity, below the ceiling: reaches the fader's own headroom
            // rather than pinning at the old dead-travel unity cap.
            const belowCeiling = FADER_MAX_GAIN - 0.1;
            paintDrawPoint(0, belowCeiling);
            const laneAfterFirstPaint = automationDrawModeState.activeSession!.pendingState!.lanes.find(
                (lane) => lane.id === laneId
            )!;
            expect(laneAfterFirstPaint.points[0]?.value).toBeCloseTo(belowCeiling);

            // Past the ceiling: still clamped, just at the real reachable maximum.
            paintDrawPoint(1, FADER_MAX_GAIN + 1);
            const laneAfterSecondPaint = automationDrawModeState.activeSession!.pendingState!.lanes.find(
                (lane) => lane.id === laneId
            )!;
            expect(laneAfterSecondPaint.points[1]?.value).toBeCloseTo(FADER_MAX_GAIN);
        } finally {
            automationDrawModeState.activeSession = null;
            vi.unstubAllGlobals();
        }
    });

    it('uses the owning device descriptor range for a device parameter lane', () => {
        const resolveRange = vi.fn(() => ({ minValue: 20, maxValue: 20_000 }));
        setAutomationParameterRangeResolver(resolveRange);

        addAutomationLane('track-1', 'device-1:high_cut', 'High Cut');

        expect(resolveRange).toHaveBeenCalledWith({
            trackId: 'track-1',
            parameterTargetId: 'device-1:high_cut',
        });
        expect(automationStore.value?.lanes[0]).toMatchObject({ minValue: 20, maxValue: 20_000 });
    });

    it('does not recreate an existing target under a different replay id', () => {
        addAutomationLane('track-1', 'gain', 'Gain', 'lane-original');
        addAutomationLane('track-1', 'gain', 'Gain', 'lane-replay');

        expect(automationStore.value?.lanes.map((lane) => lane.id)).toEqual(['lane-original']);
    });

    it('does not rescale an existing lane when its descriptor range is now available', () => {
        const existing = {
            ...createAutomationLane('track-1', 'device-1:high_cut', 'High Cut', 0, 1),
            id: 'lane-existing',
        };
        automationStore.set({ lanes: [existing] });
        const resolveRange = vi.fn(() => ({ minValue: 20, maxValue: 20_000 }));
        setAutomationParameterRangeResolver(resolveRange);

        addAutomationLane('track-1', 'device-1:high_cut', 'High Cut', 'lane-replay');

        expect(automationStore.value?.lanes).toEqual([existing]);
        expect(resolveRange).not.toHaveBeenCalled();
    });
});
