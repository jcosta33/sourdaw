import { type GainEnvelopeSeriesPoint, type Track } from '#/modules/Arrangement/stores';
// Not `#/modules/Arrangement/useCases` — same cycle law as `scheduleTrackClips`.
import { envelopeGainDbToLinear } from '#/utils/clipGainEnvelopeSchedule';
import { projectClipLoopExpansion } from '#/utils/clipLoopProjection';
import { boundStretchRatio } from '#/utils/stretchRatioBound';

import {
    type OfflineClipEnvelopeAnchor,
    type OfflineClipFadeIn,
    type OfflineClipFadeOut,
} from './scheduleOfflineClipSource';

/**
 * The clip fields the audio projection reads. A comped clip (`ResolvedClip` in
 * `scheduleTrackClips`) satisfies this with its region-adjusted beats, which is
 * exactly what the inline code read before the extraction.
 */
export type OfflineProjectableAudioClip = Pick<
    Track['clips'][number],
    | 'id'
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
    /**
     * The flat tempo, in BPM, governing a beat — `getTempoAtBeat` under this
     * render's map, which is the function the live scheduler resolves its clip
     * tempo with.
     *
     * Deliberately separate from `projectBeatToSeconds`, which integrates every
     * change in a span: timeline placement and source-content seek answer to
     * different clocks, and `scheduleAudioClips` states that contract. A
     * buffer-content offset stays on the single rate the material was recorded
     * at, so a tempo change inside the offset span must not move it.
     */
    resolveTempoAtBeat: (beat: number) => number;
    /**
     * Reads a clip's enabled gain-envelope series over an iteration's beat
     * span (#2865). Supplied by the Web Audio scheduler, whose render applies
     * the curve; deliberately absent from the native producers, whose wire
     * cannot carry it — they gate envelope-carrying clips out before they
     * project, so a playback this projection emits for them never holds one.
     */
    readGainEnvelopeSeries?: (
        clipId: string,
        spanStartBeats: number,
        spanEndBeats: number
    ) => readonly GainEnvelopeSeriesPoint[] | undefined;
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
    /**
     * The clip's gain-envelope curve over this playback, folded to where the
     * sound begins (#2865). Absent when the clip carries no envelope this
     * render applies — including on the native producers, which pass no
     * reader and gate envelope-carrying clips out instead.
     */
    envelope?: readonly OfflineClipEnvelopeAnchor[];
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
        resolveTempoAtBeat,
        readGainEnvelopeSeries,
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

    // One shared law with the live scheduler (#2532), so a corrupt ratio
    // bounces exactly as it monitors. The stretchMode gate is this
    // projector's policy and stays here, outside the law.
    const safeStretchRatio =
        clip.stretchMode && clip.stretchMode !== 'off' ? boundStretchRatio(clip.stretchRatio ?? 1) : 1;
    const clipGainValue = clip.gain;

    const clipAudioOffsetBeats = clip.audioOffsetBeats ?? 0;
    // Where the clip enters its own material, in *source* seconds — the same
    // number `scheduleAudioClips` hands to `source.start(when, offset, …)`, and
    // the same entry point both waveform renderers draw from. Two things the
    // timeline arithmetic below does are deliberately absent here:
    //
    //   - the tempo map is not integrated. The rate is the flat one governing
    //     the clip's start beat, because the material was rendered at one
    //     tempo; a change inside the offset span moves the clip on the
    //     timeline, never the point it seeks to inside the file.
    //   - the stretch ratio is not applied. It scales how long the material
    //     sounds, not where reading begins; `scheduleOfflineClipSource` scales
    //     the duration alone, exactly as live does.
    //
    // A non-positive or non-finite tempo cannot come from either tempo store,
    // both of which clamp what they hold; treating it as "no offset" keeps a
    // malformed one from turning the seek into Infinity or NaN.
    const clipTempo = resolveTempoAtBeat(clip.startBeat);
    const clipSecondsPerBeat = Number.isFinite(clipTempo) && clipTempo > 0 ? 60 / clipTempo : 0;
    const clipAudioOffsetSec = clipAudioOffsetBeats * clipSecondsPerBeat;
    const baseBufferOffsetSec = Math.max(0, clipAudioOffsetSec);
    // A negative offset — reachable by slipping content right or dragging the
    // left edge leftward, neither of which floors it — puts the clip's head
    // before the start of its source. The professional answer (Live, Cubase) is
    // silence across that span and then the file from sample 0, so the sound
    // starts later on the destination timeline by the negative span converted
    // at the playback rate, and enters the source at 0. Clamping the offset to
    // 0 instead would sound material the clip's head does not name, and passing
    // the negative number to `start()` is the `RangeError` the Web Audio
    // specification requires.
    const sourcePreRollSec = Math.max(0, -clipAudioOffsetSec) / safeStretchRatio;

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
        const iterEndTime = rawIterEndSec - regionStartSec;
        // Where this iteration's *sound* begins: its placement on the timeline,
        // pushed back by the silent span a negative offset opens at its head.
        // The iteration still ends where the clip says it does, so the pre-roll
        // shortens what is heard rather than moving the tail.
        const iterStartTime = rawIterStartSec - regionStartSec + sourcePreRollSec;
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

        // #2865 — the envelope curve's breakpoints on the destination
        // timeline, on the same law the fade times above use: beat → seconds
        // through the caller's map, plus the compensation and the region
        // origin. Unfolded on purpose — the consumer folds the series to
        // where this playback's sound begins, the same fold the live
        // scheduler makes, so a region-trimmed or pre-rolled iteration
        // enters mid-curve on both paths rather than stepping to the next
        // breakpoint.
        const envelopeSeries = readGainEnvelopeSeries?.(
            clip.id,
            iterStartBeat - clip.startBeat,
            iterEndBeat - clip.startBeat
        );
        const envelope = envelopeSeries
            ? envelopeSeries.map((point) => ({
                  timeSec: projectBeatToSeconds(clip.startBeat + point.beatOffset) + compensationDelay - regionStartSec,
                  gain: envelopeGainDbToLinear(point.gainDb),
              }))
            : undefined;

        playbacks.push({
            startSec,
            bufferOffsetSec,
            playDuration,
            playbackRate: safeStretchRatio,
            clipGainValue,
            ...(envelope ? { envelope } : {}),
            ...(fadeIn ? { fadeIn } : {}),
            ...(fadeOut ? { fadeOut } : {}),
            rawIterEndSec,
        });
    }
    return playbacks;
}
