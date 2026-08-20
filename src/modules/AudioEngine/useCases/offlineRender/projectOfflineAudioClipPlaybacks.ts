import { type Track } from '#/modules/Arrangement/stores';
// Not `#/modules/Arrangement/useCases` — same cycle law as `scheduleTrackClips`.
import { projectClipLoopExpansion } from '#/utils/clipLoopProjection';

import { type OfflineClipFadeIn, type OfflineClipFadeOut } from './scheduleOfflineClipSource';

/**
 * The clip fields the audio projection reads. A comped clip (`ResolvedClip` in
 * `scheduleTrackClips`) satisfies this with its region-adjusted beats, which is
 * exactly what the inline code read before the extraction.
 */
export type OfflineProjectableAudioClip = Pick<
    Track['clips'][number],
    | 'startBeat'
    | 'endBeat'
    | 'loopLength'
    | 'loopEnabled'
    | 'stretchMode'
    | 'stretchRatio'
    | 'gain'
    | 'fadeInBeats'
    | 'fadeOutBeats'
    | 'audioOffsetBeats'
>;

export type ProjectOfflineAudioClipPlaybacksInput = Readonly<{
    clip: OfflineProjectableAudioClip;
    /** `buffer.duration` of the clip's decoded material, in source seconds. */
    bufferDurationSeconds: number;
    regionStartBeat: number;
    /** `projectBeatToSeconds(regionStartBeat)`, resolved once by the caller. */
    regionStartSec: number;
    durationSeconds: number;
    compensationDelay: number;
    projectBeatToSeconds: (beat: number) => number;
}>;

/**
 * One playback of the clip's material — one loop iteration that survived every
 * bound. Every field is in the vocabulary of `scheduleOfflineClipSource`, and
 * of the contract's `AudioGraphClipPlayback`, which is the point of the
 * extraction: the same numbers drive both renderers.
 */
export type OfflineAudioClipPlaybackProjection = Readonly<{
    /** Destination-timeline second at which the first frame is heard. */
    startSec: number;
    /** Where playback enters the source material, in source seconds. */
    bufferOffsetSec: number;
    /** How long the clip sounds, measured on the destination timeline. */
    playDuration: number;
    /** Source frames consumed per destination frame; `1` unmodified. */
    playbackRate: number;
    /** The clip's own level, as a linear amplitude. */
    clipGainValue: number;
    fadeIn?: OfflineClipFadeIn;
    fadeOut?: OfflineClipFadeOut;
    /**
     * This iteration's uncropped end on the raw (region-unshifted) timeline —
     * the boundary the schedule tally compares against, kept here so the tally
     * question stays answerable after the arithmetic moved.
     */
    rawIterEndSec: number;
}>;

/**
 * Project one audio clip into the playbacks an offline render schedules.
 *
 * Lifted verbatim out of `scheduleTrackClips`, which consumes it unchanged, so
 * that the native export path (#2225) maps the *same* loop, trim, stretch and
 * fade arithmetic into `schedule-clip` commands rather than a second copy of
 * it. Pure: the two seams that were interleaved with it — the Web Audio node
 * construction and the tally — stayed with the callers.
 */
export function projectOfflineAudioClipPlaybacks(
    input: ProjectOfflineAudioClipPlaybacksInput
): OfflineAudioClipPlaybackProjection[] {
    const {
        clip,
        bufferDurationSeconds,
        regionStartBeat,
        regionStartSec,
        durationSeconds,
        compensationDelay,
        projectBeatToSeconds,
    } = input;

    const clipVisualLength = clip.endBeat - clip.startBeat;
    if (clipVisualLength <= 0) {
        return [];
    }

    const loopProjection = projectClipLoopExpansion({
        clipDurationBeats: clipVisualLength,
        configuredLoopLengthBeats: clip.loopLength,
        loopEnabled: clip.loopEnabled ?? false,
    });
    const loopLen = loopProjection.loopLengthBeats;
    const maxIterations = loopProjection.iterationCount;

    const stretchRatio = clip.stretchMode && clip.stretchMode !== 'off' ? (clip.stretchRatio ?? 1) : 1;
    // Clamp stretchRatio to a sane positive range — zero or negative would
    // cause division-by-zero in `bufferDurationSeconds / stretchRatio`.
    const safeStretchRatio = Math.max(0.01, Math.min(100, stretchRatio));
    const clipGainValue = clip.gain;

    const clipAudioOffsetBeats = clip.audioOffsetBeats ?? 0;
    const clipOffsetTimelineSec =
        clipAudioOffsetBeats > 0
            ? projectBeatToSeconds(clip.startBeat + clipAudioOffsetBeats) - projectBeatToSeconds(clip.startBeat)
            : 0;
    const baseBufferOffsetSec = clipOffsetTimelineSec * safeStretchRatio;

    const playbacks: OfflineAudioClipPlaybackProjection[] = [];
    for (let iter = 0; iter < maxIterations; iter++) {
        const iterStartBeat = clip.startBeat + iter * loopLen;
        if (iterStartBeat >= clip.endBeat) {
            break;
        }

        const remainingBeats = Math.min(loopLen, clip.endBeat - iterStartBeat);
        const iterEndBeat = iterStartBeat + remainingBeats;
        if (iterEndBeat <= regionStartBeat) {
            continue;
        }

        const rawIterStartSec = projectBeatToSeconds(iterStartBeat) + compensationDelay;
        const rawIterEndSec = projectBeatToSeconds(iterEndBeat) + compensationDelay;
        const iterStartTime = rawIterStartSec - regionStartSec;
        const iterEndTime = rawIterEndSec - regionStartSec;
        if (iterStartTime >= durationSeconds) {
            break;
        }

        const isFirstIter = iter === 0;
        const isLastIter = iter === maxIterations - 1 || iterStartBeat + loopLen >= clip.endBeat;

        const iterDurationSec = iterEndTime - iterStartTime;
        // Destination seconds, like every other quantity in this block: the
        // whole buffer read at this rate sounds for `duration / rate` of the
        // timeline. `scheduleOfflineClipSource` scales the span back into
        // source seconds for `start()`, so a ceiling stated here bounds the
        // material that is read.
        const remainingBufferSourceSec = Math.max(0, bufferDurationSeconds - baseBufferOffsetSec);
        const maxBufferSec = remainingBufferSourceSec / safeStretchRatio;
        const availableSec = Math.min(iterDurationSec, maxBufferSec);

        // If this iteration straddles the region start, trim the leading portion
        // by advancing the buffer read offset and clamping start to 0.
        const trimBeforeSec = Math.max(0, -iterStartTime);
        const bufferOffsetSec = baseBufferOffsetSec + trimBeforeSec * safeStretchRatio;
        if (bufferOffsetSec >= bufferDurationSeconds) {
            continue;
        }

        const startSec = Math.max(0, iterStartTime);
        const playDuration = Math.max(0, availableSec - trimBeforeSec);

        if (playDuration <= 0) {
            continue;
        }

        // `isFirstIter && trimBeforeSec === 0` is what makes a fade in present
        // at all: a later loop iteration, or one entered part-way by the region
        // trim, continues an unbroken sound and must not dip at the seam.
        // `isLastIter` is the same question for the tail.
        // Within a fade that is present, a zero-length user fade leaves
        // `userEndSec`/`userStartSec` absent, which the scheduler reads as the
        // anti-click micro-fade.
        const fadeIn =
            isFirstIter && trimBeforeSec === 0
                ? {
                      userEndSec:
                          clip.fadeInBeats > 0
                              ? projectBeatToSeconds(clip.startBeat + clip.fadeInBeats) +
                                compensationDelay -
                                regionStartSec
                              : undefined,
                  }
                : undefined;
        const fadeOut = isLastIter
            ? {
                  userStartSec:
                      clip.fadeOutBeats > 0
                          ? projectBeatToSeconds(clip.endBeat - clip.fadeOutBeats) + compensationDelay - regionStartSec
                          : undefined,
              }
            : undefined;

        playbacks.push({
            startSec,
            bufferOffsetSec,
            playDuration,
            playbackRate: safeStretchRatio,
            clipGainValue,
            ...(fadeIn ? { fadeIn } : {}),
            ...(fadeOut ? { fadeOut } : {}),
            rawIterEndSec,
        });
    }
    return playbacks;
}
