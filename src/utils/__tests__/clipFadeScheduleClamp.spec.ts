import { describe, expect, it } from 'vitest';

import {
    MICRO_FADE_SECONDS,
    clampClipFadeInDurationSeconds,
    clampClipFadeOutStartSeconds,
} from '../clipFadeScheduleClamp';

/**
 * The law half of the #2867 clip-fade schedule clamp. Do not delete without
 * replacing.
 *
 * `clampClipFadeInDurationSeconds` / `clampClipFadeOutStartSeconds` are the
 * kernel both runtimes route through — the live scheduler
 * (`scheduleAudioClips`) and the offline clip source
 * (`scheduleOfflineClipSource`). Sharing the functions makes live == offline
 * by construction, but only while both sides keep routing through them.
 */

describe('clip-fade schedule clamp — the shared half-play-duration law', () => {
    it('caps a fade longer than half the clip at half the play duration', () => {
        // The #2867 geometry: 2-beat clip (1 s at 120 BPM) with a 1.6-beat
        // fade-in (0.8 s). Half the audible span is 0.5 s.
        const playDurationSeconds = 1;
        const requestedFadeInSeconds = 1.6 / 2;
        const microFadeSeconds = 0.003;

        expect(clampClipFadeInDurationSeconds(requestedFadeInSeconds, playDurationSeconds, microFadeSeconds)).toBe(
            playDurationSeconds * 0.5
        );
    });

    it('holds a fade shorter than half the clip at the requested length, not below the anti-click floor', () => {
        expect(clampClipFadeInDurationSeconds(0.25, 1, 0.003)).toBe(0.25);
        expect(clampClipFadeInDurationSeconds(0.001, 1, 0.003)).toBe(0.003);
    });

    it('never lets the anti-click floor outrun half of a very short clip', () => {
        // Offline applied micro first, then the half cap, so a 4 ms playback
        // with a 1 ms requested fade still occupies 2 ms, not 3 ms.
        expect(clampClipFadeInDurationSeconds(0.001, 0.004, 0.003)).toBe(0.002);
    });

    it('starts a too-long fade-out at the playback midpoint, not before the sound begins', () => {
        const playbackStartSeconds = 4;
        const playDurationSeconds = 1;
        const requestedFadeOutStartSeconds = 4.2;

        expect(
            clampClipFadeOutStartSeconds(requestedFadeOutStartSeconds, playbackStartSeconds, playDurationSeconds)
        ).toBe(playbackStartSeconds + playDurationSeconds * 0.5);
    });

    it('defaults the fade-in floor to MICRO_FADE_SECONDS when not supplied', () => {
        const requestedFadeInSeconds = 0.001;
        const playDurationSeconds = 1;

        const withDefault = clampClipFadeInDurationSeconds(requestedFadeInSeconds, playDurationSeconds);
        const withExplicit = clampClipFadeInDurationSeconds(
            requestedFadeInSeconds,
            playDurationSeconds,
            MICRO_FADE_SECONDS
        );

        expect(withDefault).toBe(withExplicit);
        expect(withDefault).toBe(MICRO_FADE_SECONDS);
    });

    it('defaults the fade-out floor to MICRO_FADE_SECONDS when not supplied', () => {
        const playbackStartSeconds = 0;
        const playDurationSeconds = 0.002;
        const requestedFadeOutStartSeconds = 0;

        const withDefault = clampClipFadeOutStartSeconds(
            requestedFadeOutStartSeconds,
            playbackStartSeconds,
            playDurationSeconds
        );
        const withExplicit = clampClipFadeOutStartSeconds(
            requestedFadeOutStartSeconds,
            playbackStartSeconds,
            playDurationSeconds,
            MICRO_FADE_SECONDS
        );

        expect(withDefault).toBe(withExplicit);
    });
});
