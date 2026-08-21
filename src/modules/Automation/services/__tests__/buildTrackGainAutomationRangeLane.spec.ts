import { describe, expect, it } from 'vitest';

import { FADER_MAX_GAIN } from '#/utils/audioLevelLaw';

import { buildTrackGainAutomationRangeLane } from '../buildTrackGainAutomationRangeLane';

/**
 * The lane this service returns carries its own range, and that range is the
 * one `paintDrawPoint` clamps to and the one the lane's Y axis is drawn
 * against. Nothing else observed it: `handleAutomateTrackGainRange.spec.ts`
 * asserts the point *values* and never the lane's `minValue`/`maxValue`, so
 * this file is what makes a ceiling regression here fail.
 */
describe('buildTrackGainAutomationRangeLane', () => {
    function build(overrides: Partial<Parameters<typeof buildTrackGainAutomationRangeLane>[0]> = {}) {
        return buildTrackGainAutomationRangeLane({
            trackId: 'track-1',
            trackName: 'Drums',
            baseGain: 0.8,
            startBeat: 4,
            endBeat: 8,
            gainDb: 3,
            ...overrides,
        });
    }

    it('ranges the lane over the fader law, so a lifted point is reachable on its own axis', () => {
        const lane = build();

        expect(lane.minValue).toBe(0);
        expect(lane.maxValue).toBe(FADER_MAX_GAIN);
    });

    it('keeps a lift into the headroom inside the lane it just declared', () => {
        // +6 dB on a unity base lands at the ceiling itself: a lane still
        // ranged to unity would clamp this away.
        const lane = build({ baseGain: 1, gainDb: 6 });
        const lifted = lane.points.find((point) => point.beat === 4);

        expect(lifted?.value).toBeCloseTo(FADER_MAX_GAIN, 10);
        expect(lifted!.value).toBeLessThanOrEqual(lane.maxValue);
        expect(lifted!.value).toBeGreaterThan(1);
    });
});
