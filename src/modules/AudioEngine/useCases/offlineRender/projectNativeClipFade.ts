/**
 * One projected playback's fades, in the vocabulary `schedule-clip` takes.
 *
 * Shared by the two producers that emit `schedule-clip` — the desktop export
 * (`renderOfflineWithNativeEngine`) and the live session
 * (`projectLiveGraphProgramme`) — because they were byte-identical copies of
 * one rule and the whole point of `projectOfflineAudioClipPlaybacks` is that
 * both renders run one arithmetic.
 *
 * ── Why the endpoints are clamped to the playback, not the clip ───────────
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
 * The native mapper refuses both by name — "fadeIn reaches full before the clip
 * starts" and "fadeOut begins after the clip ends" — and a refusal is
 * whole-batch, so either edit costs an export its render and a session its
 * whole topology.
 *
 * Clamping is what the Web Audio path already does by construction: it schedules
 * the fade as gain automation at absolute times against a source that starts and
 * stops when the playback says, so a ramp that completes before the source
 * starts, or begins after it has stopped, is simply inaudible. A clamped
 * endpoint collapses to a zero-length user fade, which the engine reads as the
 * anti-click micro-fade — inaudible in exactly the same way. So this is the
 * shape that makes the native renders agree with the web one, not a bound
 * invented to satisfy the mapper.
 *
 * Only the two endpoints the mapper refuses on are moved. A fade-in that
 * reaches full after the sound ends, or a fade-out that begins before it
 * starts, are both renderable and both faithful — a fade covering the whole
 * playback is what the project asked for.
 */

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
                      fadeIn.userEndSec === undefined ? {} : { reachesFullAt: Math.max(startSec, fadeIn.userEndSec) },
              }
            : {}),
        ...(fadeOut
            ? {
                  fadeOut:
                      fadeOut.userStartSec === undefined ? {} : { beginsAt: Math.min(endSec, fadeOut.userStartSec) },
              }
            : {}),
        microFadeSeconds: MICRO_FADE_SECONDS,
    };
}
