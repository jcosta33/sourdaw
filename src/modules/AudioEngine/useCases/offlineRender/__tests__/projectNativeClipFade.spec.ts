/**
 * `projectNativeClipFade` must obey the same schedule law as both Web Audio
 * legs (#3068): `src/utils/clipFadeScheduleClamp.ts` is the single source of
 * truth for how long a scheduled fade may occupy, and this projector's job is
 * only to convert its duration/start vocabulary into the absolute endpoints
 * `schedule-clip` takes — never to re-derive the arithmetic.
 *
 * The parity table (`describe('agrees with the shared schedule law')`) is the
 * test that actually enforces "do not fork the util": it recomputes each
 * endpoint from `clampClipFadeInDurationSeconds` /
 * `clampClipFadeOutStartSeconds` directly and asserts the projector produced
 * exactly that number, so a native-side reimplementation that merely looks
 * similar fails it.
 */

import { describe, expect, it } from 'vitest';

import { clampClipFadeInDurationSeconds, clampClipFadeOutStartSeconds } from '#/utils/clipFadeScheduleClamp';

import { projectNativeClipFade } from '../projectNativeClipFade';

const MICRO_FADE_SECONDS = 0.003;

describe('projectNativeClipFade', () => {
    it('caps a fade-in longer than half the play duration to the midpoint', () => {
        // playDuration 10s, half is 5s — a fade-in requesting 8s must land at
        // startSec + 5, not startSec + 8.
        const result = projectNativeClipFade({
            startSec: 2,
            playDuration: 10,
            fadeIn: { userEndSec: 2 + 8 },
        });

        expect(result.fadeIn?.reachesFullAt).toBeCloseTo(2 + 5, 10);
    });

    it('moves a fade-out starting before the midpoint to end - playDuration/2', () => {
        // playDuration 10s starting at 2s (end 12s); a fade-out requested at
        // 3s (8s before the end) is held to the second half only: 12 - 5 = 7.
        const result = projectNativeClipFade({
            startSec: 2,
            playDuration: 10,
            fadeOut: { userStartSec: 3 },
        });

        expect(result.fadeOut?.beginsAt).toBeCloseTo(7, 10);
    });

    it('collapses a slipped clip whose fade-in ends before the playback starts to the playback edge', () => {
        // A negative audioOffsetBeats can put the clip's authored fade-in end
        // before the sound is ever heard. The shared law floors the requested
        // (negative) duration to the micro-fade, so reachesFullAt lands just
        // after startSec rather than before it.
        const result = projectNativeClipFade({
            startSec: 5,
            playDuration: 10,
            fadeIn: { userEndSec: 1 },
        });

        expect(result.fadeIn?.reachesFullAt).toBeCloseTo(5 + MICRO_FADE_SECONDS, 10);
        expect(result.fadeIn?.reachesFullAt).toBeGreaterThanOrEqual(5);
    });

    it('collapses a truncated clip whose fade-out starts after the playback ends to the playback edge', () => {
        // The playback can be clamped to what the buffer holds while the
        // clip's authored fade-out still begins at the clip's visual end,
        // which is now after the last frame anyone hears. The mapper refuses
        // a fadeOut past the clip end, so this must fold back to endSec.
        const result = projectNativeClipFade({
            startSec: 5,
            playDuration: 10,
            fadeOut: { userStartSec: 25 },
        });

        expect(result.fadeOut?.beginsAt).toBeCloseTo(15, 10);
        expect(result.fadeOut?.beginsAt).toBeLessThanOrEqual(15);
    });

    it('floors a fade-in shorter than the micro-fade to the micro-fade', () => {
        const result = projectNativeClipFade({
            startSec: 0,
            playDuration: 10,
            fadeIn: { userEndSec: 0.0005 },
        });

        expect(result.fadeIn?.reachesFullAt).toBeCloseTo(MICRO_FADE_SECONDS, 10);
    });

    it('keeps an absent fade-in absent', () => {
        const result = projectNativeClipFade({ startSec: 0, playDuration: 10 });

        expect(result.fadeIn).toBeUndefined();
        expect(result.microFadeSeconds).toBe(MICRO_FADE_SECONDS);
    });

    it('keeps a present-but-userless fade-in as an empty object, still floored downstream by microFadeSeconds', () => {
        const result = projectNativeClipFade({
            startSec: 0,
            playDuration: 10,
            fadeIn: {},
        });

        expect(result.fadeIn).toEqual({});
    });

    it('keeps an absent fade-out absent', () => {
        const result = projectNativeClipFade({ startSec: 0, playDuration: 10 });

        expect(result.fadeOut).toBeUndefined();
    });

    it('keeps a present-but-userless fade-out as an empty object, still floored downstream by microFadeSeconds', () => {
        const result = projectNativeClipFade({
            startSec: 0,
            playDuration: 10,
            fadeOut: {},
        });

        expect(result.fadeOut).toEqual({});
    });

    it('always carries microFadeSeconds regardless of which fades are present', () => {
        const result = projectNativeClipFade({
            startSec: 0,
            playDuration: 10,
            fadeIn: { userEndSec: 1 },
            fadeOut: { userStartSec: 9 },
        });

        expect(result.microFadeSeconds).toBe(MICRO_FADE_SECONDS);
    });

    describe('agrees with the shared schedule law', () => {
        // Each row recomputes the endpoint straight from the same util the Web
        // Audio legs call, so this fails if the projector ever re-derives the
        // arithmetic instead of calling through.
        const rows: ReadonlyArray<{
            readonly name: string;
            readonly startSec: number;
            readonly playDuration: number;
            readonly userEndSec: number;
            readonly userStartSec: number;
        }> = [
            { name: 'ordinary short fades', startSec: 0, playDuration: 10, userEndSec: 1, userStartSec: 9 },
            {
                name: 'fade-in longer than half, fade-out starting early',
                startSec: 4,
                playDuration: 6,
                userEndSec: 4 + 5,
                userStartSec: 4 + 1,
            },
            {
                name: 'slipped clip: fade-in end before playback start',
                startSec: 5,
                playDuration: 10,
                userEndSec: 2,
                userStartSec: 12,
            },
            {
                name: 'truncated clip: fade-out start after playback end',
                startSec: 5,
                playDuration: 10,
                userEndSec: 6,
                userStartSec: 30,
            },
            {
                name: 'sub-frame playDuration',
                startSec: 100,
                playDuration: 0.01,
                userEndSec: 100.02,
                userStartSec: 100.001,
            },
        ];

        it.each(rows)('$name', ({ startSec, playDuration, userEndSec, userStartSec }) => {
            const endSec = startSec + playDuration;
            const result = projectNativeClipFade({
                startSec,
                playDuration,
                fadeIn: { userEndSec },
                fadeOut: { userStartSec },
            });

            const expectedReachesFullAt =
                startSec + clampClipFadeInDurationSeconds(userEndSec - startSec, playDuration, MICRO_FADE_SECONDS);
            const expectedBeginsAt = Math.min(
                endSec,
                clampClipFadeOutStartSeconds(userStartSec, startSec, playDuration)
            );

            expect(result.fadeIn?.reachesFullAt).toBeCloseTo(expectedReachesFullAt, 10);
            expect(result.fadeOut?.beginsAt).toBeCloseTo(expectedBeginsAt, 10);
        });
    });
});
