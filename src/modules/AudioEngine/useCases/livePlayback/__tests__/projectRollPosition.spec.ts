/**
 * Where a native roll is aimed, given the time a session start cost (#3577).
 *
 * The law alone, with no engine behind it: the position the gesture asked for
 * plus the context time that has passed since, wrapped into the loop region
 * when the wait crossed its end.
 */

import { describe, expect, it } from 'vitest';

import { projectRollPosition } from '../projectRollPosition';

/** The region a loop gesture engaged, one second long from 2 to 3. */
const LOOP_REGION = { enabled: true, startSeconds: 2, endSeconds: 3 };

describe('projectRollPosition', () => {
    it('carries the position forward by the context time the start cost', () => {
        expect(
            projectRollPosition({
                positionSeconds: 2.5,
                anchoredAtContextSeconds: 10,
                nowContextSeconds: 10.08,
                loopRegion: null,
                loopEnabled: false,
            })
        ).toBeCloseTo(2.58, 9);
    });

    it('carries nothing forward when the clock has not advanced past the anchor', () => {
        // A suspended context's clock stands still, and a replaced one can read
        // behind the anchor. Either way no Web Audio material was rendered in
        // between, so rolling behind the gesture would repeat audio nobody
        // heard.
        expect(
            projectRollPosition({
                positionSeconds: 2.5,
                anchoredAtContextSeconds: 10,
                nowContextSeconds: 9.9,
                loopRegion: null,
                loopEnabled: false,
            })
        ).toBe(2.5);
    });

    it('wraps a projection that crossed the loop end back into the region', () => {
        // Web Audio wrapped at the seam while the session was starting, so the
        // engine has to land where it did rather than a loop ahead of it.
        expect(
            projectRollPosition({
                positionSeconds: 2.95,
                anchoredAtContextSeconds: 10,
                nowContextSeconds: 10.08,
                loopRegion: LOOP_REGION,
                loopEnabled: true,
            })
        ).toBeCloseTo(2.03, 9);
    });

    it('plays straight through from a position already past the loop end', () => {
        // The engine's own meaning of a locate past the loop end: a region
        // cannot pull in a playhead that never entered it.
        expect(
            projectRollPosition({
                positionSeconds: 3.5,
                anchoredAtContextSeconds: 10,
                nowContextSeconds: 10.08,
                loopRegion: LOOP_REGION,
                loopEnabled: true,
            })
        ).toBeCloseTo(3.58, 9);
    });

    it('never wraps at a region the engine answered it will not honour', () => {
        // The requested region is not the engine's answer about it, and a
        // region held without being honoured wraps nothing.
        expect(
            projectRollPosition({
                positionSeconds: 2.95,
                anchoredAtContextSeconds: 10,
                nowContextSeconds: 10.08,
                loopRegion: LOOP_REGION,
                loopEnabled: false,
            })
        ).toBeCloseTo(3.03, 9);
    });

    it('never wraps at a zero-length region', () => {
        expect(
            projectRollPosition({
                positionSeconds: 2.95,
                anchoredAtContextSeconds: 10,
                nowContextSeconds: 10.08,
                loopRegion: { enabled: true, startSeconds: 2, endSeconds: 2 },
                loopEnabled: true,
            })
        ).toBeCloseTo(3.03, 9);
    });
});
