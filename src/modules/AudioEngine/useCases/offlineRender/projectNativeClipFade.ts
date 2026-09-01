/**
 * One projected playback's fades, in the vocabulary `schedule-clip` takes.
 *
 * Shared by the two producers that emit `schedule-clip` — the desktop export
 * (`renderOfflineWithNativeEngine`) and the live session
 * (`projectLiveGraphProgramme`) — because they were byte-identical copies of
 * one rule and the whole point of `projectOfflineAudioClipPlaybacks` is that
 * both renders run one arithmetic.
 *
 * ── One schedule law, both runtimes ────────────────────────────────────────
 *
 * `src/utils/clipFadeScheduleClamp.ts` (#2867) is the single source of truth
 * for how long a scheduled fade may occupy: never shorter than the anti-click
 * micro-fade, never longer than half the audible play duration. Both Web
 * Audio legs call it (`scheduleAudioClips`, `scheduleOfflineClipSource`); this
 * projector calls it too, rather than re-deriving the same arithmetic, so a
 * native render agrees with the audible path instead of coincidentally
 * matching it.
 *
 * The util speaks in durations and starts; `schedule-clip`'s `fadeIn`/
 * `fadeOut` speak in absolute endpoints (`reachesFullAt`, `beginsAt`) on the
 * same clock as the playback itself. Converting is what this file does: a
 * fade-in's requested duration is `userEndSec - startSec`, clamped and added
 * back to `startSec`; a fade-out's requested start is `userStartSec` itself,
 * clamped directly by the util's own start-based signature.
 *
 * ── Why a fade-out's clamped start is still capped to the playback's end ──
 *
 * `projectOfflineAudioClipPlaybacks` derives a fade endpoint from the *clip's*
 * beats while it derives the playback's own bounds from what is actually heard,
 * and two ordinary edits pull those apart:
 *
 *   - **A slipped clip.** A negative `audioOffsetBeats` puts the clip's head
 *     before the start of its material, so the sound begins later than the clip
 *     does by that silent span. The user's fade-in still ends where the clip's
 *     beats say, which is now *before* the first frame anyone hears.
 *   - **A clip longer than its material.** The playback is clamped to what the
 *     buffer holds, so the sound ends early. The user's fade-out still begins at
 *     the clip's visual end, which is now *after* the last frame anyone hears.
 *
 * The shared util holds a fade-out start to `>= playbackStart` and
 * `>= end - half`, but never `<= end` — it has no reason to, since every other
 * caller's `end` is the clock the requested start was already measured against.
 * Here the *clip's* end can sit past the *playback's* end, so a further
 * `Math.min(endSec, …)` runs after the util to fold that case back down. The
 * native mapper refuses a fade-out that begins after the clip ends — a
 * one-frame rounding tolerance aside — and a refusal is whole-batch, so this
 * final fold is what keeps a truncated clip's export and session alive at all,
 * exactly as clamping a fade-in to `>= startSec` (the util's own floor,
 * unconditionally satisfied once `startSec` is added back) keeps a slipped
 * clip's alive.
 *
 * Clamping is what the Web Audio path already does by construction: it schedules
 * the fade as gain automation at absolute times against a source that starts and
 * stops when the playback says, so a ramp that completes before the source
 * starts, or begins after it has stopped, is simply inaudible. A clamped
 * endpoint collapses to a zero-length user fade, which the engine reads as the
 * anti-click micro-fade — inaudible in exactly the same way. So this is the
 * shape that makes the native renders agree with the web one, not a bound
 * invented to satisfy the mapper.
 */

import { clampClipFadeInDurationSeconds, clampClipFadeOutStartSeconds } from '#/utils/clipFadeScheduleClamp';

import { type AudioGraphClipFade } from '../../models/AudioGraphBackend';

import { MICRO_FADE_SECONDS } from './constants';

export type NativeClipFadeInput = Readonly<{
    /** The playback's own first heard second — `startSec` on the projection. */
    startSec: number;
    /** How long it sounds, after every trim and material bound — `playDuration`. */
    playDuration: number;
    fadeIn?: Readonly<{ userEndSec?: number }>;
    fadeOut?: Readonly<{ userStartSec?: number }>;
}>;

export function projectNativeClipFade(input: NativeClipFadeInput): AudioGraphClipFade {
    const { startSec, playDuration, fadeIn, fadeOut } = input;
    const endSec = startSec + playDuration;
    return {
        ...(fadeIn
            ? {
                  fadeIn:
                      fadeIn.userEndSec === undefined
                          ? {}
                          : {
                                reachesFullAt:
                                    startSec +
                                    clampClipFadeInDurationSeconds(
                                        fadeIn.userEndSec - startSec,
                                        playDuration,
                                        MICRO_FADE_SECONDS
                                    ),
                            },
              }
            : {}),
        ...(fadeOut
            ? {
                  fadeOut:
                      fadeOut.userStartSec === undefined
                          ? {}
                          : {
                                beginsAt: Math.min(
                                    endSec,
                                    clampClipFadeOutStartSeconds(fadeOut.userStartSec, startSec, playDuration)
                                ),
                            },
              }
            : {}),
        microFadeSeconds: MICRO_FADE_SECONDS,
    };
}
