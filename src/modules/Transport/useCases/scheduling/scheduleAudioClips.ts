import { getGainEnvelopeSeries, trackStore } from '#/modules/Arrangement/stores';
import { resolveClipsWithComping } from '#/modules/Arrangement/useCases';
import {
    createBufferSource,
    ensureTrackStrip,
    getAudioContext,
    getCachedAudioBuffer,
    getCompensationDelay,
    getCurrentTime,
} from '#/modules/AudioEngine/useCases';
import { collaborationStore } from '#/modules/Collaboration/stores';
import { getAssetTransfer } from '#/modules/Collaboration/useCases';
import { projectAudioLoopPassSegments } from '#/utils/audioSourceTime';
import {
    MICRO_FADE_SECONDS,
    clampClipFadeInDurationSeconds,
    clampClipFadeOutStartSeconds,
} from '#/utils/clipFadeScheduleClamp';
import {
    applyGainCurveAnchorsToParam,
    envelopeGainDbToLinear,
    foldGainCurveAnchorsToAudibleStart,
} from '#/utils/clipGainEnvelopeSchedule';
import { projectClipLoopExpansion } from '#/utils/clipLoopProjection';
import { notifyUser } from '#/utils/Notification/notifyUser';
import { boundStretchRatio } from '#/utils/stretchRatioBound';

import { getTempoAtBeat, secondsBetweenBeats } from '../../models/TempoMap';
import { type TransportState } from '../../models/TransportState';
import { type TempoChange, tempoMapStore } from '../../stores/tempoMapStore';
import { type SourceWithFade, cutSource, schedulerSession } from '../playheadScheduler/schedulerSession';

import { gainNodePool } from './audioClipSchedulingState';
import { disposeAudioClipScheduling } from './disposeAudioClipScheduling';
import { scheduleFrozenTrack } from './scheduleFrozenTrack';

function acquireGainNode(ctx: BaseAudioContext): GainNode {
    const node = gainNodePool.pop();
    if (node) {
        node.gain.cancelScheduledValues(ctx.currentTime);
        node.gain.setValueAtTime(1, ctx.currentTime);
        return node;
    }
    return ctx.createGain();
}

function releaseGainNode(node: GainNode, ctx: BaseAudioContext): void {
    try {
        node.disconnect();
        node.gain.cancelScheduledValues(ctx.currentTime);
        gainNodePool.push(node);
    } catch {
        // node might already be disconnected
    }
}

// Vite HMR: clear the pool before this module is replaced so a fresh
// AudioContext never inherits GainNodes wired into the disposed graph.
import.meta.hot?.dispose(() => {
    disposeAudioClipScheduling();
});

type ResolvedAudioPart = ReturnType<typeof resolveClipsWithComping>[number];

/** The resolved part an emitted source plays, and the dedup key its pass took. */
type ScheduledPartTag = {
    trackId: string;
    clipId: string;
    partKey: string;
    scheduledKey: string;
};

type ScheduledPartSource = SourceWithFade & { scheduledPart?: ScheduledPartTag };

function playableAudioBufferId(part: ResolvedAudioPart): string | null {
    if (part.muted || part.type !== 'audio' || !part.audioBufferId) {
        return null;
    }
    return part.audioBufferId;
}

/**
 * A part's content identity: its clip, its region, and the media it reads
 * there. Two takes of one clip comped over the same region differ only in
 * their source entry, so the entry is part of the key or a take swap would be
 * deduplicated as the part already playing.
 */
function audioPartKey(part: ResolvedAudioPart, bufferId: string): string {
    const entry =
        part.audioOffsetSeconds !== undefined ? `s${part.audioOffsetSeconds}` : `b${part.audioOffsetBeats ?? 0}`;
    return `${part.id}:${part.regionStartBeat}:${part.regionEndBeat}:${bufferId}:${entry}`;
}

function resolvesSamePart(parts: readonly ResolvedAudioPart[], tag: ScheduledPartTag): boolean {
    return parts.some((part) => {
        if (part.id !== tag.clipId) {
            return false;
        }
        const bufferId = playableAudioBufferId(part);
        return bufferId !== null && audioPartKey(part, bufferId) === tag.partKey;
    });
}

/**
 * A comp, take, mute or clip edit reaches the scheduler only as this pass's
 * resolution. A source emitted for a part the resolution no longer holds, with
 * the same identity, is cut on the teardown ramp and its key dropped, so this
 * pass schedules what the edit made: a part sounding now rejoins mid-buffer
 * through the late branch, and a future part schedules fresh. Sources of
 * unchanged parts are left alone.
 */
function cutSupersededParts(
    trackId: string,
    parts: readonly ResolvedAudioPart[],
    scheduledAudioClipsSet: Set<string>,
    activeAudioSources: AudioBufferSourceNode[],
    ctx: BaseAudioContext
): void {
    for (let index = activeAudioSources.length - 1; index >= 0; index--) {
        const source: ScheduledPartSource = activeAudioSources[index]!;
        const tag = source.scheduledPart;
        if (!tag || tag.trackId !== trackId || resolvesSamePart(parts, tag)) {
            continue;
        }
        cutSource(source, ctx);
        activeAudioSources.splice(index, 1);
        scheduledAudioClipsSet.delete(tag.scheduledKey);
    }
}

/** One scheduling pass's view of one audio track. */
type TrackAudioEmission = {
    trackId: string;
    ctx: BaseAudioContext;
    changes: readonly TempoChange[];
    transport: TransportState;
    fromBeat: number;
    toBeat: number;
    floorsToWindowStart: boolean;
    initialSchedulingAnchor: number | undefined;
    compensation: number;
    scheduledAudioClipsSet: Set<string>;
    activeAudioSources: AudioBufferSourceNode[];
};

/** How a part's beats become audio instants, and the clock read its late branch measures against (null: read it). */
type EmissionTiming = {
    beatToAudioTime: (beat: number) => number;
    now: number | null;
};

/** The transport loop's seam: the pass after it belongs to the seam handover, never to this window. */
function reachesTransportLoopEnd(emission: TrackAudioEmission, beat: number): boolean {
    const { transport, fromBeat } = emission;
    return transport.isLooping === true && fromBeat < transport.loopEnd && beat >= transport.loopEnd;
}

/**
 * A comp boundary inside a clip is known in advance, so the parts that carry
 * the clip on from it with no gap are emitted with the part before them, at
 * their exact instants, instead of waiting for a window to reach them: a
 * main-thread stall longer than the look-ahead would otherwise let the next
 * take fall due unscheduled and join it mid-buffer, losing its head. The run
 * stops at a gap, another clip, a part that cannot sound, a part looping over
 * several passes, or the transport loop end.
 */
function emitContinuingParts(
    emission: TrackAudioEmission,
    parts: readonly ResolvedAudioPart[],
    first: ResolvedAudioPart,
    firstTiming: EmissionTiming
): void {
    let previous = first;
    let timing: EmissionTiming | null = firstTiming;
    while (timing !== null && !reachesTransportLoopEnd(emission, previous.endBeat)) {
        const boundaryBeat = previous.endBeat;
        const next = parts.find((part) => part.id === previous.id && part.startBeat === boundaryBeat);
        if (!next) {
            return;
        }
        const bufferId = playableAudioBufferId(next);
        const buffer = bufferId === null ? null : getCachedAudioBuffer({ bufferId });
        if (bufferId === null || !buffer) {
            return;
        }
        timing = emitAudioPart(emission, next, audioPartKey(next, bufferId), buffer, timing, 'continuation');
        previous = next;
    }
}

/**
 * Emits one resolved part's passes and returns the timing the part that
 * continues it is placed with, or null when nothing may continue it.
 */
function emitAudioPart(
    emission: TrackAudioEmission,
    clip: ResolvedAudioPart,
    clipKey: string,
    buffer: AudioBuffer,
    timing: EmissionTiming,
    passes: 'window' | 'continuation'
): EmissionTiming | null {
    const {
        trackId,
        ctx,
        changes,
        transport,
        fromBeat,
        toBeat,
        floorsToWindowStart,
        initialSchedulingAnchor,
        compensation,
        scheduledAudioClipsSet,
        activeAudioSources,
    } = emission;
    const { beatToAudioTime } = timing;
    // Acquired with the first pass this call emits: a part already emitted is
    // revisited every pass, and the engine graph is not touched for it.
    let strip: ReturnType<typeof ensureTrackStrip> | undefined;
    // One shared law with the offline projector (#2532): the stored
    // ratio is finiteness-checked at its write paths but never
    // range-checked, and a raw 0 or negative here divides the derived
    // durations into NaN/Infinity so the iteration falls into the
    // do-not-start branch below — silently dropped live while the
    // bounce clamps and plays. The stretchMode gate is this
    // scheduler's policy and stays here, outside the law.
    const stretchRatio = clip.stretchMode && clip.stretchMode !== 'off' ? boundStretchRatio(clip.stretchRatio ?? 1) : 1;
    // The clip's own level is the plateau every fade ramp below targets,
    // exactly as the offline render folds `clipGainValue` into its fade
    // gain (`scheduleOfflineClipSource`): live ramps run 0 → clipGain → 0,
    // never 0 → 1 → 0, or a gained clip monitors at the wrong level while
    // the export prints the right one.
    const clipGain = clip.gain;
    const clipTempo = getTempoAtBeat(changes, clip.startBeat, transport.tempo);

    const clipVisualLength = clip.endBeat - clip.startBeat;
    const loopProjection = projectClipLoopExpansion({
        clipDurationBeats: clipVisualLength,
        configuredLoopLengthBeats: clip.loopLength,
        loopEnabled: clip.loopEnabled ?? false,
    });
    const loopLen = loopProjection.loopLengthBeats;
    const maxIterations = loopProjection.iterationCount;
    const loopEnabled = clip.loopEnabled ?? false;
    // Only a part sounding as one pass hands over at its end: a part looping
    // over several passes has its own loop seams, which the windows own.
    const isSinglePass = maxIterations === 1;
    if (passes === 'continuation' && !isSinglePass) {
        return null;
    }
    let startIteration = 0;
    let endIteration = Math.min(1, maxIterations);
    if (loopEnabled && passes === 'window') {
        startIteration = Math.max(0, Math.floor((fromBeat - clip.startBeat) / loopLen));
        endIteration = Math.min(maxIterations, Math.ceil((toBeat - clip.startBeat) / loopLen));
        startIteration = Math.min(startIteration, endIteration);
    }

    let continuation: EmissionTiming | null = null;
    for (let iter = startIteration; iter < endIteration; iter++) {
        const iterOffsetBeats = iter * loopLen;
        const iterStartBeat = clip.startBeat + iterOffsetBeats;
        if (iterStartBeat >= clip.endBeat) {
            break;
        }
        const scheduledIterationKey = loopEnabled ? `${clipKey}:${String(iter)}` : clipKey;
        if (scheduledAudioClipsSet.has(scheduledIterationKey)) {
            if (isSinglePass) {
                continuation = timing;
            }
            continue;
        }
        scheduledAudioClipsSet.add(scheduledIterationKey);
        strip ??= ensureTrackStrip(trackId);
        const partTag: ScheduledPartTag = {
            trackId,
            clipId: clip.id,
            partKey: clipKey,
            scheduledKey: scheduledIterationKey,
        };

        const remainingBeats = clip.endBeat - iterStartBeat;
        const iterDurationBeats = Math.min(loopLen, remainingBeats);

        const isFirstIter = iter === 0;
        const isLastIter = iter === maxIterations - 1 || iterStartBeat + loopLen >= clip.endBeat;
        const needsMicroFadeIn = isFirstIter && clip.fadeInBeats === 0;
        const needsMicroFadeOut = isLastIter && clip.fadeOutBeats === 0;

        const fadeGain = acquireGainNode(ctx);
        // #2865 — the envelope is the whole curve over this
        // iteration's span, not one sample of it pinned as a static
        // value. The series is acquired here, next to the node it
        // rides; its ramp anchors go on below, once the beat→time
        // mapping they anchor to has been computed. Absent when the
        // clip carries no envelope that moves, so the node is too.
        const envelopeSeries = getGainEnvelopeSeries(clip.id, iterOffsetBeats, iterOffsetBeats + iterDurationBeats);
        const envGainNode = envelopeSeries ? acquireGainNode(ctx) : null;

        // Every segment of the pass shares the fade and envelope nodes,
        // so a ramp laid over the pass runs unbroken across the loop
        // wrap between the segments.
        let outputNode: AudioNode = strip.gainNode;
        if (fadeGain) {
            fadeGain.connect(outputNode);
            outputNode = fadeGain;
        }
        if (envGainNode) {
            envGainNode.connect(outputNode);
            outputNode = envGainNode;
        }

        const passSegments = projectAudioLoopPassSegments({
            clip,
            loopLengthBeats: loopLen,
            iterationStartBeat: iterStartBeat,
            iterationEndBeat: iterStartBeat + iterDurationBeats,
            stretchRatio,
            tempoAtClipStart: clipTempo,
            secondsAtBeat: (beat) => secondsBetweenBeats(changes, 0, beat, transport.tempo),
        });

        // The pass head's time is read before `now`, in the same order
        // the single-source read always used: the two clock reads are
        // independent, and the late-start branch below measures the
        // elapsed span against this pass's head instant. A continuing part
        // shares the clock read of the part it continues.
        const iterStartTime = beatToAudioTime(iterStartBeat);
        const now = timing.now ?? getCurrentTime();
        type StartedSegment = {
            soundStartTime: number;
            playDuration: number;
            audibleStartTime: number;
            preRollSeconds: number;
        };
        const startedSegments: StartedSegment[] = [];
        const startedSources: AudioBufferSourceNode[] = [];

        for (const segment of passSegments) {
            const segmentStartBeat = iterStartBeat + segment.startOffsetBeats;
            const segmentEndBeat = iterStartBeat + segment.endOffsetBeats;
            // Timeline duration of this segment: derived from the same
            // beat→time mapping as its start so start and length agree
            // under a tempo curve.
            const segmentDurationSeconds = secondsBetweenBeats(
                changes,
                segmentStartBeat,
                segmentEndBeat,
                transport.tempo
            );
            // Every segment's start walks beats from the pass head's
            // one clock read (`iterStartTime`) — never from a fresh
            // `getCurrentTime()` taken after the previous segment's
            // source was built, connected and started. Chromium
            // advances `AudioContext.currentTime` once per 128-sample
            // render quantum, so a second read could land a quantum
            // late and open a ~2.67 ms live-only gap at the wrap seam
            // that the tail's read-anchored end does not have.
            const segmentStartTime =
                iterStartTime + secondsBetweenBeats(changes, iterStartBeat, segmentStartBeat, transport.tempo);
            const segmentSourceStartSeconds = segment.sourceStartSeconds;
            // A negative source start — reachable and unfloored from
            // both write paths, `slipClipContent` and a leftward
            // left-edge drag in `trimClipStart` — puts the segment's
            // head before the start of its source. Handing that number
            // to `start()` is the `RangeError` the Web Audio
            // specification requires, and this call sits in the
            // scheduler tick with no `catch` around it, so the throw
            // also skips that tick's automation, VCA and modulation
            // passes.
            //
            // The professional answer (Live, Cubase) is silence across
            // the negative span and then the file from sample 0, which
            // is what the offline render bounces. The span is source
            // seconds, so crossing it costs `span / rate` of the
            // timeline; the segment still ends where the pass says it
            // does, so the pre-roll shortens what is heard rather than
            // moving the tail.
            const sourceOffsetSeconds = Math.max(0, segmentSourceStartSeconds);
            const preRollSeconds = Math.max(0, -segmentSourceStartSeconds) / stretchRatio;
            const soundStartTime = segmentStartTime + preRollSeconds;
            const playDuration = Math.min(
                segmentDurationSeconds - preRollSeconds,
                (buffer.duration - sourceOffsetSeconds) / stretchRatio
            );
            // Nothing audible remains in this segment: the pre-roll
            // swallowed it, or its read already sits past the end of
            // the material. Starting a zero-length source would only
            // burn a node.
            if (playDuration <= 0) {
                continue;
            }

            // #4784 — a loop wrap opens the window at loopStart while
            // the beat→time anchor carries the wrapped playhead past it
            // (or, on the scheduled seam, a negative-phase beat before
            // it), so a clip spanning the wrap maps its head deep into
            // the past. The mid-buffer continuation below answered that
            // with content at `accumulatedPosition − compensation` —
            // material from before the loop when the compensation
            // outruns the distance already travelled into the pass.
            // The window's own first beat is the earliest content this
            // emission may sound; when its due instant is still ahead
            // of the source's own start, the source begins there
            // instead, holding the window's content.
            let floorStartTime = segmentStartTime;
            if (initialSchedulingAnchor !== undefined) {
                floorStartTime = Math.max(floorStartTime, initialSchedulingAnchor + compensation);
            }
            if (floorsToWindowStart && fromBeat > segmentStartBeat) {
                floorStartTime = Math.max(floorStartTime, beatToAudioTime(fromBeat));
            }
            const audibleStartTime = Math.max(soundStartTime, floorStartTime);

            const source = createBufferSource();
            source.buffer = buffer;
            if (stretchRatio !== 1) {
                source.playbackRate.value = stretchRatio;
            }
            // The figure a loop-seam fence spares this source's tail by
            // (#4784): the material it carries is scheduled this late,
            // so it is still due this long past the seam.
            (source as SourceWithFade).compensationSeconds = compensation;
            (source as SourceWithFade).fadeGainNode = fadeGain;
            (source as ScheduledPartSource).scheduledPart = partTag;
            source.connect(outputNode);

            if (audibleStartTime >= now) {
                const startBufferOffset = sourceOffsetSeconds + (audibleStartTime - soundStartTime) * stretchRatio;
                const startDuration = (soundStartTime + playDuration - audibleStartTime) * stretchRatio;
                if (startBufferOffset >= buffer.duration || startDuration <= 0) {
                    continue;
                }
                source.start(audibleStartTime, startBufferOffset, startDuration);
            } else {
                const elapsed = now - soundStartTime;
                const bufferOffset = elapsed * stretchRatio + sourceOffsetSeconds;
                if (
                    bufferOffset >= buffer.duration ||
                    bufferOffset >= playDuration * stretchRatio + sourceOffsetSeconds
                ) {
                    // Source isn't started; the pass's shared nodes
                    // release below if no segment started at all.
                    continue;
                }
                source.start(now, bufferOffset, playDuration * stretchRatio + sourceOffsetSeconds - bufferOffset);
            }

            startedSources.push(source);
            startedSegments.push({ soundStartTime, playDuration, audibleStartTime, preRollSeconds });
        }

        if (startedSources.length === 0) {
            // No segment of the pass produced a startable source.
            releaseGainNode(fadeGain, ctx);
            if (envGainNode) {
                releaseGainNode(envGainNode, ctx);
            }
            continue;
        }
        if (isSinglePass) {
            // The part continuing this one starts where this pass's beats
            // end, walked from this pass's own head instant and clock read,
            // so the two meet on the same audio instant.
            continuation = {
                beatToAudioTime: (beat) =>
                    iterStartTime + secondsBetweenBeats(changes, iterStartBeat, beat, transport.tempo),
                now,
            };
        }

        // The fade in anchors at the pass's first sound and the fade
        // out at its last: the ramps live on the shared nodes, so they
        // run unbroken across the wrap seam between the segments.
        const firstSegment: StartedSegment = startedSegments[0]!;
        const lastSegment: StartedSegment = startedSegments[startedSegments.length - 1]!;
        const soundStartTime = firstSegment.soundStartTime;
        const audibleStartTime = firstSegment.audibleStartTime;

        if (fadeGain) {
            // Anchored to where sound begins, not to the clip's head:
            // with no pre-roll the two are the same instant, and with
            // one there is nothing to ramp until the source reaches
            // sample 0. A wrap floor (#4784) holds the sound start
            // later still, and the ramp follows it. Offline clamps the
            // fade remaining after that sound start
            // (`userEndSec - startSec`); live feeds the same quantity
            // so a pre-roll cannot shift the plateau.
            const effectiveStart = Math.max(audibleStartTime, now);

            if (isFirstIter && clip.fadeInBeats > 0) {
                // A fade length is a span of the timeline, so it is measured
                // with the timeline's own mapping. Dividing by the clip's
                // local rate made the ramp outlast (or undershoot) its beat
                // span whenever a tempo change fell inside the fade.
                const userFadeEndTime =
                    iterStartTime +
                    secondsBetweenBeats(changes, iterStartBeat, iterStartBeat + clip.fadeInBeats, transport.tempo);
                const fadeInSeconds = clampClipFadeInDurationSeconds(
                    userFadeEndTime - soundStartTime,
                    firstSegment.playDuration
                );
                const fadeInEnd = soundStartTime + fadeInSeconds;
                if (effectiveStart < fadeInEnd) {
                    const progressRatio = Math.max(0, effectiveStart - soundStartTime) / fadeInSeconds;
                    fadeGain.gain.setValueAtTime(progressRatio * clipGain, effectiveStart);
                    fadeGain.gain.linearRampToValueAtTime(clipGain, fadeInEnd);
                } else if (firstSegment.preRollSeconds > 0) {
                    // The drawn fade window fully elapsed inside the pre-roll
                    // silence, so `effectiveStart` lands past `fadeInEnd` with
                    // nothing left to ramp — but drawing a fade is the gesture
                    // that says "no click here", and the source is about to
                    // start on a discontinuity regardless. Give it the same
                    // anti-click MICRO_FADE_SECONDS gives an undrawn fade,
                    // rather than jumping straight to the clip's level. This
                    // leaves the no-pre-roll transport-resume case
                    // (preRollSeconds === 0) alone: that one starts mid-buffer,
                    // where the discontinuity is unavoidable and a ramp would
                    // only mask real material.
                    fadeGain.gain.setValueAtTime(0, effectiveStart);
                    fadeGain.gain.linearRampToValueAtTime(clipGain, effectiveStart + MICRO_FADE_SECONDS);
                } else {
                    fadeGain.gain.setValueAtTime(clipGain, effectiveStart);
                }
            } else if (needsMicroFadeIn) {
                fadeGain.gain.setValueAtTime(0, effectiveStart);
                fadeGain.gain.linearRampToValueAtTime(clipGain, effectiveStart + MICRO_FADE_SECONDS);
            } else {
                fadeGain.gain.setValueAtTime(clipGain, effectiveStart);
            }

            if (isLastIter && clip.fadeOutBeats > 0) {
                const clipEndTime = beatToAudioTime(clip.endBeat);
                const fadeOutStart = clampClipFadeOutStartSeconds(
                    clipEndTime -
                        secondsBetweenBeats(changes, clip.endBeat - clip.fadeOutBeats, clip.endBeat, transport.tempo),
                    lastSegment.soundStartTime,
                    lastSegment.playDuration
                );
                fadeGain.gain.setValueAtTime(clipGain, Math.max(fadeOutStart, effectiveStart));
                fadeGain.gain.linearRampToValueAtTime(0, clipEndTime);
            } else if (needsMicroFadeOut) {
                // The source stops at its sound start plus its play
                // duration however playback reached it: a start at or
                // past the sound head plays
                // `playDuration·stretchRatio` buffer-seconds from the
                // sound start, and a mid-clip start (transport resume,
                // loop wrap, locate) plays the remaining
                // `(playDuration − elapsed)·stretchRatio` from `now` —
                // both spans land on the same instant, the rate
                // cancelling on either side. Anchoring on
                // `effectiveStart` scheduled the ramp `elapsed`
                // seconds past a source that had already stopped, so
                // it sounded nothing and the clip clicked (#4690).
                const sourceEndTime = lastSegment.soundStartTime + lastSegment.playDuration;
                fadeGain.gain.setValueAtTime(clipGain, Math.max(effectiveStart, sourceEndTime - MICRO_FADE_SECONDS));
                fadeGain.gain.linearRampToValueAtTime(0, sourceEndTime);
            }
        }

        if (envGainNode && envelopeSeries) {
            // #2865 — the envelope's breakpoints, mapped through the
            // same beat→time law every fade above uses and held to
            // where sound actually begins, laid on the param as a ramp
            // series. The offline render folds its copy at the
            // playback's `startSec` on the same shared law, so the
            // curve a bounce prints is the curve monitored here.
            // Anchors may precede `now` on a mid-clip transport start;
            // the param evaluates them exactly as drawn, which is why
            // the fold — not a re-anchoring — keeps a resume mid-curve.
            const anchors = foldGainCurveAnchorsToAudibleStart(
                envelopeSeries.map((point) => ({
                    time: beatToAudioTime(clip.startBeat + point.beatOffset),
                    gain: envelopeGainDbToLinear(point.gainDb),
                })),
                Math.max(audibleStartTime, now)
            );
            applyGainCurveAnchorsToParam(envGainNode.gain, anchors);
        }

        // The pass's segments share the fade and envelope nodes; the
        // last source to end releases them.
        let sourcesStillPlaying = startedSources.length;
        for (const source of startedSources) {
            activeAudioSources.push(source);
            source.onended = () => {
                const idx = activeAudioSources.indexOf(source);
                if (idx >= 0) {
                    activeAudioSources.splice(idx, 1);
                }
                sourcesStillPlaying -= 1;
                if (sourcesStillPlaying === 0) {
                    if (fadeGain) {
                        releaseGainNode(fadeGain, ctx);
                    }
                    if (envGainNode) {
                        releaseGainNode(envGainNode, ctx);
                    }
                }
            };
        }
    }
    return continuation;
}

export function scheduleAudioClips(
    fromBeat: number,
    toBeat: number,
    accumulatedPosition: number,
    scheduledAudioClipsSet: Set<string>,
    scheduledFrozenTracks: Set<string>,
    activeAudioSources: AudioBufferSourceNode[],
    transport: TransportState,
    initialSchedulingAnchor?: number
): void {
    const tracks = trackStore.value?.tracks;
    if (!tracks) {
        return;
    }

    const changes = tempoMapStore.value?.changes ?? [];
    const ctx = getAudioContext();

    // #3651 — the live twin of the offline mixdown's FX-8 cue-send rule. The
    // strip's mute node (`postFaderGain`) sits downstream of the pre-fader tap
    // (`TrackNode.setMute`), so a muted track still feeds its pre-fader (cue)
    // sends. Skipping the track here left the send with no source: the bus was
    // silent live while the export, which schedules these tracks, played them.
    // A muted track is therefore scheduled when a pre-fader send can still
    // reach a bus; the strip's own mute keeps the direct path silent. A
    // post-fader send dies with the mute, and a send to a bus that no longer
    // exists reaches nothing, so both stay skipped. Solo gating keeps its
    // stronger exclusion law in the engine: `setSoloGate` closes `preFaderTap`
    // itself, upstream of every send tap, so a solo-gated track feeds nothing
    // even when scheduled — the scheduler stays solo-blind, as it always has.
    const busTrackIds = new Set(
        tracks.filter((candidate) => candidate.kind === 'bus').map((candidate) => candidate.id)
    );

    // The window floor below (#4784) names a boundary the playhead stands at or
    // behind: a wrap handover — the window opening at loopStart while the
    // playhead is wrapped onto it or still negative-phase before it — or a
    // landing, where the window opens at the landing beat itself. A
    // steady-state window instead opens one look-ahead ahead of the playhead,
    // and flooring a fresh mid-pass join to it held the source silent for
    // look-ahead + compensation while skipping the material in between; there
    // the unfloored mid-buffer continuation is the correct join.
    //
    // The seam handover has a second window shape those clauses miss: on the
    // ticks between the scheduled seam and its instant, the emission opens at
    // the incoming pass's high-water mark (`wrappedUpTo`, ahead of loopStart)
    // while the playhead is still negative-phase below it, and a clip that
    // first becomes schedulable there — a decode finishing, an unmute — joined
    // at `now` with content from before loopStart. When the playhead itself
    // sits in the wrap handover (below loopStart while a seam is pending or
    // just recorded), the join floors to the window start: the earlier windows
    // already emitted everything before it, and nothing pre-loop may sound in
    // the incoming pass.
    const playheadInWrapHandover =
        transport.isLooping === true &&
        accumulatedPosition < transport.loopStart &&
        (schedulerSession.pendingSeam !== null || schedulerSession.lastLoopSeamAudioTime !== null);
    const floorsToWindowStart =
        fromBeat <= accumulatedPosition ||
        (transport.isLooping === true && fromBeat === transport.loopStart) ||
        playheadInWrapHandover;

    for (const track of tracks) {
        if (track.kind !== 'audio') {
            continue;
        }
        if (track.muted && !track.sends.some((send) => send.preFader && busTrackIds.has(send.busId))) {
            continue;
        }

        if (track.freezeState.status === 'frozen' && track.freezeState.frozenBufferId) {
            // Key by content, not just track.id (same contract as
            // scheduleMidiNotes): an unfreeze → refreeze keeps the track id but
            // replaces frozenBufferId, and a bare-id key would keep the dedup
            // entry and leave the refrozen track silent for the whole session.
            const frozenKey = `${track.id}:${track.freezeState.frozenBufferId}`;
            if (!scheduledFrozenTracks.has(frozenKey)) {
                const scheduled = scheduleFrozenTrack(
                    track,
                    accumulatedPosition,
                    activeAudioSources,
                    transport.tempo,
                    floorsToWindowStart ? fromBeat : null,
                    initialSchedulingAnchor
                );
                if (scheduled) {
                    scheduledFrozenTracks.add(frozenKey);
                }
            }
            continue;
        }

        const compensation = getCompensationDelay(track.id);
        const resolvedAudioClips = resolveClipsWithComping(track.id, track.clips);
        cutSupersededParts(track.id, resolvedAudioClips, scheduledAudioClipsSet, activeAudioSources, ctx);

        // Single source of truth for beat → audio-context time on the timeline.
        // Every timeline quantity — iteration start, iteration length, fade
        // boundaries — goes through this one mapping, so they cannot disagree
        // about the tempo basis. It integrates the tempo map instead of
        // dividing by the tempo at the playhead: with a tempo change inside
        // the look-ahead the flat rate placed the clip at the wrong instant
        // and sized it wrongly, drifting against MIDI, which converts through
        // the map. Source entry is canonical seconds, or legacy beats read
        // at the clip's start tempo.
        function beatToAudioTime(beat: number): number {
            return (
                (initialSchedulingAnchor ?? getCurrentTime()) +
                secondsBetweenBeats(changes, accumulatedPosition, beat, transport.tempo) +
                compensation
            );
        }
        const windowTiming: EmissionTiming = { beatToAudioTime, now: null };
        const emission: TrackAudioEmission = {
            trackId: track.id,
            ctx,
            changes,
            transport,
            fromBeat,
            toBeat,
            floorsToWindowStart,
            initialSchedulingAnchor,
            compensation,
            scheduledAudioClipsSet,
            activeAudioSources,
        };

        for (const clip of resolvedAudioClips) {
            const bufferId = playableAudioBufferId(clip);
            if (bufferId === null) {
                continue;
            }
            const clipKey = audioPartKey(clip, bufferId);
            const outsideWindow = clip.startBeat > toBeat || clip.endBeat < fromBeat;
            if (scheduledAudioClipsSet.has(clipKey)) {
                // Emitted by an earlier pass: what continues it may have been
                // replaced since by an edit this pass's reconciliation cut.
                if (!outsideWindow) {
                    emitContinuingParts(emission, resolvedAudioClips, clip, windowTiming);
                }
                continue;
            }
            if (outsideWindow) {
                continue;
            }

            const buffer = getCachedAudioBuffer({ bufferId });
            if (!buffer) {
                const isRecordingClip = bufferId.startsWith('rec-');
                if (!isRecordingClip) {
                    const inSession = collaborationStore.value?.isEnabled ?? false;
                    if (inSession && clip.assetHash) {
                        // Deliberately unconditional: AssetTransfer owns both the
                        // dedup and the retry policy, because only it knows
                        // whether a request is still alive. It drops calls while
                        // one is outstanding or in flight, holds a cooldown after
                        // an abort, and abandons a hash that keeps failing. A
                        // dedup Set here instead recorded "asked once, ever":
                        // after a corrupt chunk or a dead sender aborted the
                        // transfer, the asset could never be re-requested for the
                        // rest of the session and the clip stayed silent forever.
                        getAssetTransfer()?.requestAsset(clip.assetHash);
                    } else {
                        notifyUser(`Missing audio for clip "${clip.name}" — re-import the audio file`, 'warning');
                        scheduledAudioClipsSet.add(clipKey);
                    }
                }
                continue;
            }

            const continuation = emitAudioPart(emission, clip, clipKey, buffer, windowTiming, 'window');
            if (continuation) {
                emitContinuingParts(emission, resolvedAudioClips, clip, continuation);
            }
        }
    }
}
