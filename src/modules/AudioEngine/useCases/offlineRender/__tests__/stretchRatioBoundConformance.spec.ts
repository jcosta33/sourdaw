import { describe, expect, it } from 'vitest';

import { boundStretchRatio } from '#/utils/stretchRatioBound';

import { projectOfflineAudioClipPlaybacks } from '../projectOfflineAudioClipPlaybacks';

/**
 * #2532 conformance gate — OFFLINE side. Do not delete without replacing.
 *
 * The offline projector must realise every clip at the rate the shared kernel
 * (`#/utils/stretchRatioBound`) produces, because that kernel is also what
 * the live scheduler routes through — the mix you bounce is the mix you
 * monitor. The sibling spec in Transport `scheduling`
 * (`scheduleAudioClips.spec.ts`, "realises a stored stretch ratio … at
 * exactly the shared-law rate") pins the live routing against the same
 * kernel, and `src/utils/__tests__/stretchRatioBound.spec.ts` pins the law
 * itself. If either runtime re-forks its bound, one of these trips.
 *
 * Both siblings pin the same clip geometry (4 beats at 120 BPM flat, a 100 s
 * buffer) so the material-seconds numbers below are the same numbers the
 * live spec asserts against `source.start()`'s duration argument: rate and
 * material span agree across the two runtimes, not just rate.
 */

const CLIP_SPAN_SECONDS = 2; // 4 beats at 120 BPM.
const BUFFER_SECONDS = 100;

function projectWithStretchRatio(raw: number) {
    return projectOfflineAudioClipPlaybacks({
        clip: {
            startBeat: 0,
            endBeat: 4,
            loopLength: undefined,
            loopEnabled: false,
            stretchMode: 'timestretch',
            stretchRatio: raw,
            gain: 1,
            fadeInBeats: 0,
            fadeOutBeats: 0,
            audioOffsetBeats: 0,
        },
        bufferDurationSeconds: BUFFER_SECONDS,
        regionStartBeat: 0,
        regionStartSec: 0,
        durationSeconds: 4,
        compensationDelay: 0,
        projectBeatToSeconds: (beat) => beat / 2,
        resolveTempoAtBeat: () => 120,
    });
}

describe('stretch-ratio bound conformance — offline projector applies the shared bound', () => {
    it.each([0, -2, 0.005, 1, 2, 99, 100, 1000])(
        'realises a stored stretch ratio of %d at exactly the shared-law rate',
        (raw) => {
            const playbacks = projectWithStretchRatio(raw);

            // The clip bounces — one playback survives every bound, never
            // dropped the way the pre-fix live scheduler dropped it.
            expect(playbacks).toHaveLength(1);
            expect(playbacks[0]!.playbackRate).toBe(boundStretchRatio(raw));
            expect(playbacks[0]!.playDuration).toBeGreaterThan(0);
        }
    );

    it.each([
        { name: 'zero', raw: 0, expectedRate: 0.01, expectedMaterialSeconds: 0.02 },
        { name: 'negative', raw: -2, expectedRate: 0.01, expectedMaterialSeconds: 0.02 },
        { name: 'far past the ceiling', raw: 10_000, expectedRate: 100, expectedMaterialSeconds: 100 },
    ])(
        'spans a $name stretch ratio by the same material seconds the live scheduler starts',
        ({ raw, expectedRate, expectedMaterialSeconds }) => {
            const playbacks = projectWithStretchRatio(raw);

            expect(playbacks).toHaveLength(1);
            expect(playbacks[0]!.playbackRate).toBe(expectedRate);
            // Material seconds = min(timeline span, buffer / rate) * rate: the
            // same arithmetic `scheduleAudioClips` hands `source.start()` for
            // this geometry (its regression rows pin these exact numbers).
            expect(playbacks[0]!.playDuration * playbacks[0]!.playbackRate).toBeCloseTo(expectedMaterialSeconds, 9);
            // The corrupt rows really are corrupt: their raw values would have
            // divided or blown past the buffer had the bound not floor/ceilinged
            // them, so the row is not vacuously passing at rate 1.
            expect(expectedRate).not.toBe(raw);
        }
    );

    it('bounds the timeline span the buffer admits, not just the rate', () => {
        // At the ceiling the 100 s buffer bounds the 2 s timeline span first:
        // 100 / 100 = 1 s of timeline, the span the live scheduler's
        // `Math.min` also picks for `source.start()`.
        const playbacks = projectWithStretchRatio(1000);
        expect(playbacks).toHaveLength(1);
        expect(playbacks[0]!.playbackRate).toBe(100);
        expect(playbacks[0]!.playDuration).toBeCloseTo(1, 9);
        // And below any bound the span is the clip's whole timeline span.
        expect(projectWithStretchRatio(2)[0]!.playDuration).toBeCloseTo(CLIP_SPAN_SECONDS, 9);
    });

    it('leaves the stretchMode gate in place: mode off ignores a corrupt stored ratio', () => {
        const playbacks = projectOfflineAudioClipPlaybacks({
            clip: {
                startBeat: 0,
                endBeat: 4,
                loopLength: undefined,
                loopEnabled: false,
                stretchMode: 'off',
                stretchRatio: 10_000,
                gain: 1,
                fadeInBeats: 0,
                fadeOutBeats: 0,
                audioOffsetBeats: 0,
            },
            bufferDurationSeconds: BUFFER_SECONDS,
            regionStartBeat: 0,
            regionStartSec: 0,
            durationSeconds: 4,
            compensationDelay: 0,
            projectBeatToSeconds: (beat) => beat / 2,
            resolveTempoAtBeat: () => 120,
        });

        // Unmodified rate and the clip's whole timeline span, exactly as the
        // live scheduler's `off` branch leaves the ratio at 1.
        expect(playbacks).toHaveLength(1);
        expect(playbacks[0]!.playbackRate).toBe(1);
        expect(playbacks[0]!.playDuration).toBeCloseTo(CLIP_SPAN_SECONDS, 9);
    });
});
