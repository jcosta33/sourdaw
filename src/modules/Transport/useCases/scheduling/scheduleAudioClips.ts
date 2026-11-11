import { getGainEnvelopeSeries, gainEnvelopeStore, trackStore } from '#/modules/Arrangement/stores';
import { collaborationAssetTransfer, resolveClipsWithComping } from '#/modules/Arrangement/useCases';
import {
    createBufferSource,
    ensureTrackStrip,
    getAudioContext,
    getCachedAudioBuffer,
    getCompensationDelay,
    getCurrentTime,
} from '#/modules/AudioEngine/useCases';
import { projectAudioLoopPassSegments } from '#/utils/audioSourceTime';
import {
    applyGainCurveAnchorsToParam,
    envelopeGainDbToLinear,
    foldGainCurveAnchorsToAudibleStart,
} from '#/utils/clipGainEnvelopeSchedule';
import { projectClipLoopExpansion } from '#/utils/clipLoopProjection';
import { notifyUser } from '#/utils/Notification/notifyUser';
import { boundStretchRatio } from '#/utils/stretchRatioBound';
import { valuesEqual } from '#/utils/structuralEquality';

import { type SourceWithFade } from '../../models/SourceWithFade';
import { getTempoAtBeat, secondsBetweenBeats } from '../../models/TempoMap';
import { type TransportState } from '../../models/TransportState';
import { type TempoChange, tempoMapStore } from '../../stores/tempoMapStore';
import { cutSource } from '../playheadScheduler/cutSource';
import { schedulerSession } from '../playheadScheduler/schedulerSession';

import { gainNodePool } from './audioClipSchedulingState';
import { disposeAudioClipScheduling } from './disposeAudioClipScheduling';
import { projectAudioClipFadeSchedule } from './projectAudioClipFadeSchedule';
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

/** The resolved part an emitted source plays, its timeline span, and the dedup key its pass took. */
type ScheduledPartTag = {
    trackId: string;
    clipId: string;
    partKey: string;
    scheduledKey: string;
    programme: ReturnType<typeof partProgramme>;
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

function partProgramme(part: ResolvedAudioPart) {
    const envelope = gainEnvelopeStore.value?.envelopes[part.id];
    const source = [
        part.startBeat,
        part.endBeat,
        part.audioOffsetSeconds,
        part.audioOffsetBeats,
        part.audioUnwrappedOffsetSeconds,
        part.audioLoopStartSeconds,
        part.audioLoopPassEntrySeconds,
        part.audioLoopPassOriginBeat,
        part.loopEnabled,
        part.loopLength,
        part.loopOriginBeat,
        part.stretchMode,
        part.stretchRatio,
        part.gain,
        part.fadeInBeats,
        part.fadeOutBeats,
    ];
    if (!envelope) {
        return { source, envelope: null };
    }
    return {
        source,
        envelope: {
            enabled: envelope.enabled,
            points: envelope.points.map((point) => [point.beatOffset, point.gainDb]),
        },
    };
}

function resolvesSamePart(parts: readonly ResolvedAudioPart[], tag: ScheduledPartTag): boolean {
    return parts.some((part) => {
        if (part.id !== tag.clipId) {
            return false;
        }
        const bufferId = playableAudioBufferId(part);
        return (
            bufferId !== null &&
            audioPartKey(part, bufferId) === tag.partKey &&
            valuesEqual(partProgramme(part), tag.programme)
        );
    });
}

/**
 * A comp, take, mute or clip edit reaches the scheduler only as this pass's
 * resolution. A source emitted for a part the resolution no longer holds, with
 * the same identity, is cut on the teardown ramp and its key dropped, so this
 * pass schedules what the edit made: a part sounding now rejoins mid-buffer
 * through the late branch, and a future part schedules fresh. Sources of
 * unchanged parts are left alone. Returns whether it cut anything.
 */
function cutSupersededParts(
    trackId: string,
    parts: readonly ResolvedAudioPart[],
    scheduledAudioClipsSet: Set<string>,
    activeAudioSources: AudioBufferSourceNode[],
    ctx: BaseAudioContext
): boolean {
    let cutAny = false;
    for (let index = activeAudioSources.length - 1; index >= 0; index--) {
        const source: ScheduledPartSource = activeAudioSources[index]!;
        const tag = source.scheduledPart;
        if (!tag || tag.trackId !== trackId) {
            continue;
        }
        const replacement = parts.find(
            (part) =>
                part.id === tag.clipId &&
                part.audioBufferId !== undefined &&
                audioPartKey(part, part.audioBufferId) === tag.partKey
        );
        let replacementBuffer: AudioBuffer | null = null;
        if (replacement?.audioBufferId) {
            replacementBuffer = getCachedAudioBuffer({ bufferId: replacement.audioBufferId });
        }
        const replacedBuffer = replacementBuffer !== null && replacementBuffer !== source.buffer;
        const changedCompensation = source.compensationSeconds !== getCompensationDelay(trackId);
        if (resolvesSamePart(parts, tag) && !replacedBuffer && !changedCompensation) {
            continue;
        }
        if (source.scheduledStartTime !== undefined && source.scheduledStartTime >= ctx.currentTime) {
            source.stop(ctx.currentTime);
            source.scheduledStopTime = ctx.currentTime;
        } else {
            cutSource(source, ctx);
            source.scheduledStopTime = ctx.currentTime + 0.005;
        }
        activeAudioSources.splice(index, 1);
        scheduledAudioClipsSet.delete(tag.scheduledKey);
        cutAny = true;
    }
    return cutAny;
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

type AudioSegmentPlan = {
    soundStartTime: number;
    playDuration: number;
    audibleStartTime: number;
    preRollSeconds: number;
    startTime: number;
    bufferOffset: number;
    bufferDuration: number;
};

type AudioPassPreparation = Pick<
    TrackAudioEmission,
    'changes' | 'transport' | 'fromBeat' | 'floorsToWindowStart' | 'initialSchedulingAnchor' | 'compensation'
> & {
    passSegments: ReturnType<typeof projectAudioLoopPassSegments>;
    iterStartBeat: number;
    iterStartTime: number;
    now: number;
    stretchRatio: number;
    buffer: AudioBuffer;
    beatToAudioTime: EmissionTiming['beatToAudioTime'];
};

function prepareAudioPassSegments(input: AudioPassPreparation): AudioSegmentPlan[] {
    const {
        passSegments,
        changes,
        transport,
        fromBeat,
        floorsToWindowStart,
        initialSchedulingAnchor,
        compensation,
        iterStartBeat,
        iterStartTime,
        now,
        stretchRatio,
        buffer,
        beatToAudioTime,
    } = input;
    const plans: AudioSegmentPlan[] = [];
    for (const segment of passSegments) {
        const segmentStartBeat = iterStartBeat + segment.startOffsetBeats;
        const segmentEndBeat = iterStartBeat + segment.endOffsetBeats;
        // Timeline duration of this segment: derived from the same
        // beat→time mapping as its start so start and length agree
        // under a tempo curve.
        const segmentDurationSeconds = secondsBetweenBeats(changes, segmentStartBeat, segmentEndBeat, transport.tempo);
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

        let startTime = audibleStartTime;
        let bufferOffset = sourceOffsetSeconds + (audibleStartTime - soundStartTime) * stretchRatio;
        let bufferDuration = (soundStartTime + playDuration - audibleStartTime) * stretchRatio;
        if (audibleStartTime < now) {
            startTime = now;
            bufferOffset = (now - soundStartTime) * stretchRatio + sourceOffsetSeconds;
            bufferDuration = playDuration * stretchRatio + sourceOffsetSeconds - bufferOffset;
        }
        if (bufferOffset >= buffer.duration || bufferDuration <= 0) {
            continue;
        }
        plans.push({
            soundStartTime,
            playDuration,
            audibleStartTime,
            preRollSeconds,
            startTime,
            bufferOffset,
            bufferDuration,
        });
    }
    return plans;
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
            programme: partProgramme(clip),
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
        const startedSources: AudioBufferSourceNode[] = [];
        let plans: AudioSegmentPlan[];
        let fadeSchedule: ReturnType<typeof projectAudioClipFadeSchedule> | null = null;
        try {
            plans = prepareAudioPassSegments({
                passSegments,
                changes,
                transport,
                fromBeat,
                floorsToWindowStart,
                initialSchedulingAnchor,
                compensation,
                iterStartBeat,
                iterStartTime,
                now,
                stretchRatio,
                buffer,
                beatToAudioTime,
            });
            if (plans.length > 0) {
                // Resolve the legacy fade-out read after the floor reads, before
                // any start can advance the clock. Envelope clocks stay below.
                let fadeInEndTime: number | null = null;
                if (isFirstIter && clip.fadeInBeats > 0) {
                    fadeInEndTime =
                        iterStartTime +
                        secondsBetweenBeats(changes, iterStartBeat, iterStartBeat + clip.fadeInBeats, transport.tempo);
                }
                let fadeOut: { endTime: number; duration: number } | null = null;
                if (isLastIter && clip.fadeOutBeats > 0) {
                    fadeOut = {
                        endTime: beatToAudioTime(clip.endBeat),
                        duration: secondsBetweenBeats(
                            changes,
                            clip.endBeat - clip.fadeOutBeats,
                            clip.endBeat,
                            transport.tempo
                        ),
                    };
                }
                fadeSchedule = projectAudioClipFadeSchedule({
                    first: plans[0]!,
                    last: plans[plans.length - 1]!,
                    now,
                    clipGain,
                    fadeInEndTime,
                    fadeOut,
                    microFadeIn: needsMicroFadeIn,
                    microFadeOut: needsMicroFadeOut,
                });
                // Only this acquired FREE fade node is reset. Cancel its entire
                // former timeline: intrinsic gain cannot override a pooled unity event.
                fadeGain.gain.cancelScheduledValues(0);
                fadeGain.gain.value = fadeSchedule.initialGain;
            }
        } catch (error) {
            releaseGainNode(fadeGain, ctx);
            if (envGainNode) {
                releaseGainNode(envGainNode, ctx);
            }
            throw error;
        }
        for (const plan of plans) {
            let source: AudioBufferSourceNode | undefined;
            try {
                source = createBufferSource();
                source.buffer = buffer;
                if (stretchRatio !== 1) {
                    source.playbackRate.value = stretchRatio;
                }
                // The source's compensated tail belongs to this same pass.
                (source as SourceWithFade).compensationSeconds = compensation;
                (source as SourceWithFade).fadeGainNode = fadeGain;
                (source as ScheduledPartSource).scheduledPart = partTag;
                (source as SourceWithFade).scheduledTrackId = trackId;
                (source as SourceWithFade).scheduledBufferId = clip.audioBufferId;
                (source as SourceWithFade).scheduledAudioKey = scheduledIterationKey;
                source.connect(outputNode);
                source.start(plan.startTime, plan.bufferOffset, plan.bufferDuration);
            } catch (error) {
                source?.disconnect();
                if (startedSources.length === 0) {
                    releaseGainNode(fadeGain, ctx);
                    if (envGainNode) {
                        releaseGainNode(envGainNode, ctx);
                    }
                }
                throw error;
            }
            const startedSource = source;
            Object.assign(startedSource, {
                scheduledStartTime: plan.startTime,
                scheduledBufferOffset: plan.bufferOffset,
                scheduledPlaybackRate: startedSource.playbackRate.value,
                scheduledEndTime: plan.startTime + plan.bufferDuration / startedSource.playbackRate.value,
            });

            startedSources.push(startedSource);
            // Publish each successful start before another segment or gain
            // write can throw, so its pass owner can retire partial work.
            activeAudioSources.push(startedSource);
            startedSource.onended = () => {
                const activeIndex = activeAudioSources.indexOf(startedSource);
                if (activeIndex >= 0) {
                    activeAudioSources.splice(activeIndex, 1);
                }
                const startedIndex = startedSources.indexOf(startedSource);
                if (startedIndex >= 0) {
                    startedSources.splice(startedIndex, 1);
                }
                if (startedSources.length === 0) {
                    releaseGainNode(fadeGain, ctx);
                    if (envGainNode) {
                        releaseGainNode(envGainNode, ctx);
                    }
                }
            };
        }

        if (isSinglePass) {
            // The part continuing this one starts where this pass's beats
            // end, walked from this pass's own head instant and clock read,
            // so the two meet on the same audio instant. The instant holds
            // whether or not this pass sounds anything: a silent part (its
            // entry past the material, or swallowed by pre-roll) still ends
            // where its beats end.
            continuation = {
                beatToAudioTime: (beat) =>
                    iterStartTime + secondsBetweenBeats(changes, iterStartBeat, beat, transport.tempo),
                now,
            };
        }
        if (startedSources.length === 0) {
            // No segment of the pass produced a startable source.
            releaseGainNode(fadeGain, ctx);
            if (envGainNode) {
                releaseGainNode(envGainNode, ctx);
            }
            continue;
        }

        // One ordered programme drives both initialization and automation.
        // Keep writes after starts so each partial source is already owned if a write fails.
        for (const event of fadeSchedule!.events) {
            if (event.kind === 'set') {
                fadeGain.gain.setValueAtTime(event.gain, event.time);
            } else {
                fadeGain.gain.linearRampToValueAtTime(event.gain, event.time);
            }
        }
        const audibleStartTime = plans[0]!.audibleStartTime;

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

    // Every track's superseded sources are cut before any track emits. An
    // edit's replacement need not sit on the track or span it cut — a clip
    // moved to another track, or nudged — and a dedup key dropped by a later
    // track's cut would otherwise still read as emitted to an earlier track.
    const audioTracks: { track: (typeof tracks)[number]; parts: ResolvedAudioPart[] }[] = [];
    let cutAny = false;
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

        const parts = resolveClipsWithComping(track.id, track.clips);
        cutAny = cutSupersededParts(track.id, parts, scheduledAudioClipsSet, activeAudioSources, ctx) || cutAny;
        audioTracks.push({ track, parts });
    }

    // A steady-state window opens one look-ahead past the playhead, so what an
    // edit put in place of a cut source can still sound between the playhead
    // and the window start, where the window never looks: a replacement ending
    // there, or a looping part's current pass, would stay silent until its
    // end. After a cut, each part is therefore emitted over a window opening
    // at the playhead, which admits it only if it still sounds there and joins
    // it through the late branch; the dedup set keeps every part an earlier
    // pass emitted from starting again. A window that floors to its own start
    // (a wrap handover or landing) holds nothing before it to rejoin, and a
    // pass that cut nothing leaves the window rules alone.
    const rejoinsAtPlayhead = cutAny && !floorsToWindowStart && accumulatedPosition < fromBeat;

    for (const { track, parts: resolvedAudioClips } of audioTracks) {
        const compensation = getCompensationDelay(track.id);

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
            fromBeat: rejoinsAtPlayhead ? accumulatedPosition : fromBeat,
            toBeat,
            floorsToWindowStart,
            initialSchedulingAnchor,
            compensation,
            scheduledAudioClipsSet,
            activeAudioSources,
        };

        for (const clip of resolvedAudioClips) {
            if (reachesTransportLoopEnd(emission, clip.startBeat)) {
                continue;
            }
            const bufferId = playableAudioBufferId(clip);
            if (bufferId === null) {
                continue;
            }
            const clipKey = audioPartKey(clip, bufferId);
            const outsideWindow = clip.startBeat > toBeat || clip.endBeat < emission.fromBeat;
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
                    const assets = collaborationAssetTransfer.read('scheduleAudioClips');
                    if (assets.isSessionActive() && clip.assetHash) {
                        // Deliberately unconditional: AssetTransfer owns both the
                        // dedup and the retry policy, because only it knows
                        // whether a request is still alive. It drops calls while
                        // one is outstanding or in flight, holds a cooldown after
                        // an abort, and abandons a hash that keeps failing. A
                        // dedup Set here instead recorded "asked once, ever":
                        // after a corrupt chunk or a dead sender aborted the
                        // transfer, the asset could never be re-requested for the
                        // rest of the session and the clip stayed silent forever.
                        assets.current()?.requestAsset(clip.assetHash);
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
