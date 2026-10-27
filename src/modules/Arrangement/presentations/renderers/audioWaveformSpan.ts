import { resolveAudioSourceOffsetSeconds, projectAudioLoopPassSegments } from '#/utils/audioSourceTime';
import { projectClipLoopExpansion } from '#/utils/clipLoopProjection';
import { boundStretchRatio } from '#/utils/stretchRatioBound';

import type { ClipRenderModel, TimelineRenderModel } from '../../models/TimelineRenderModel';

type SourceTimeline = NonNullable<TimelineRenderModel['sourceTimeline']>;

function flatSourceTimeline(secondsPerBeat: number): SourceTimeline {
    return {
        secondsAtBeat: (beat) => beat * secondsPerBeat,
        beatAtSeconds: (seconds) => seconds / secondsPerBeat,
    };
}

export type AudioWaveformDrawSpan = {
    startSample: number;
    endSample: number;
    leadingSilenceBeats: number;
    audibleTimelineBeats: number;
    sourceStartSeconds: number;
    sourceEndSeconds: number;
    soundStartSongSeconds: number;
    audibleStartBeat: number;
    stretchRatio: number;
};

/** One source window for one actual playback iteration. */
export function computeAudioWaveformDrawSpan({
    offsetBeats,
    offsetSeconds,
    stretchRatio,
    clipBeats,
    secondsPerBeat,
    sampleRate,
    clipStartBeat = 0,
    timeline = flatSourceTimeline(secondsPerBeat),
    bufferLengthSamples,
}: {
    offsetBeats: number;
    offsetSeconds?: number;
    stretchRatio: number;
    clipBeats: number;
    secondsPerBeat: number;
    sampleRate: number;
    clipStartBeat?: number;
    timeline?: SourceTimeline;
    bufferLengthSamples?: number;
}): AudioWaveformDrawSpan {
    const ratio = boundStretchRatio(stretchRatio);
    const sourceOffsetSeconds = resolveAudioSourceOffsetSeconds(
        { audioOffsetSeconds: offsetSeconds, audioOffsetBeats: offsetBeats },
        60 / secondsPerBeat
    );
    const sourceStartSeconds = Math.max(0, sourceOffsetSeconds);
    const sourceLimitSeconds = bufferLengthSamples === undefined ? Infinity : bufferLengthSamples / sampleRate;
    const iterationStartSeconds = timeline.secondsAtBeat(clipStartBeat);
    const iterationDurationSeconds = timeline.secondsAtBeat(clipStartBeat + clipBeats) - iterationStartSeconds;
    const preRollSeconds = Math.max(0, -sourceOffsetSeconds) / ratio;
    const soundStartSongSeconds = iterationStartSeconds + preRollSeconds;
    const audibleStartBeat = timeline.beatAtSeconds(soundStartSongSeconds);
    const audibleTimelineBeats = clipBeats - (audibleStartBeat - clipStartBeat);
    const availableSourceSeconds = Math.max(0, sourceLimitSeconds - sourceStartSeconds);
    const sourceDurationSeconds = Math.min(
        Math.max(0, iterationDurationSeconds - preRollSeconds) * ratio,
        availableSourceSeconds
    );
    const sourceEndSeconds = sourceStartSeconds + sourceDurationSeconds;

    return {
        startSample: Math.max(0, Math.floor(sourceStartSeconds * sampleRate)),
        // Peaks cover every PCM cell intersecting the half-open source span.
        // A fractional end includes its last cell; an integer end excludes it.
        endSample: Math.max(
            0,
            Math.min(
                bufferLengthSamples ?? Infinity,
                Math.ceil(sourceStartSeconds * sampleRate + sourceDurationSeconds * sampleRate)
            )
        ),
        leadingSilenceBeats: audibleStartBeat - clipStartBeat,
        audibleTimelineBeats,
        sourceStartSeconds,
        sourceEndSeconds,
        soundStartSongSeconds,
        audibleStartBeat,
        stretchRatio: ratio,
    };
}

export type AudioWaveformOccurrence = {
    iteration: number;
    span: AudioWaveformDrawSpan;
    numBins: number;
};

type CachedLayout = {
    timeline: TimelineRenderModel['sourceTimeline'];
    programme: ClipRenderModel['audioProgramme'];
    key: string;
    occurrences: readonly AudioWaveformOccurrence[];
    peakPositions: Map<string, Float64Array>;
};

const layoutCache = new WeakMap<ClipRenderModel, CachedLayout>();

function layoutKey(
    clip: ClipRenderModel,
    model: TimelineRenderModel,
    sampleRate: number,
    bufferLength: number,
    maxBins: number
): string {
    return [
        clip.startBeat,
        clip.endBeat,
        clip.audioOffsetSeconds,
        clip.audioLoopStartSeconds,
        clip.audioLoopPassEntrySeconds,
        clip.audioLoopPassOriginBeat,
        clip.loopOriginBeat,
        clip.audioOffsetBeats,
        clip.clipStartTempo,
        clip.stretchMode,
        clip.stretchRatio,
        clip.loopEnabled,
        clip.loopLength,
        model.tempo,
        model.viewportStartBeat,
        model.viewportEndBeat,
        model.pixelsPerBeat,
        sampleRate,
        bufferLength,
        maxBins,
    ].join(':');
}

function visibleSourceWindow(
    span: AudioWaveformDrawSpan,
    timeline: SourceTimeline,
    iterationEndBeat: number,
    viewportStartBeat: number,
    viewportEndBeat: number,
    sampleRate: number
): AudioWaveformDrawSpan | null {
    const soundEndSongSeconds =
        span.soundStartSongSeconds + (span.sourceEndSeconds - span.sourceStartSeconds) / span.stretchRatio;
    const boundedEndBeat = Math.min(iterationEndBeat, viewportEndBeat);
    const boundedEndSongSeconds = timeline.secondsAtBeat(boundedEndBeat);
    const visibleStartBeat = Math.max(span.audibleStartBeat, viewportStartBeat);
    let visibleEndBeat = boundedEndBeat;
    if (boundedEndSongSeconds > soundEndSongSeconds) {
        visibleEndBeat = timeline.beatAtSeconds(soundEndSongSeconds);
    }
    if (visibleEndBeat <= visibleStartBeat) {
        return null;
    }

    // Uncropped source endpoints already belong to this span. An inverse and
    // forward round trip can move one just below its exact PCM boundary.
    let visibleStartSongSeconds = span.soundStartSongSeconds;
    let sourceStartSeconds = span.sourceStartSeconds;
    if (visibleStartBeat > span.audibleStartBeat) {
        visibleStartSongSeconds = timeline.secondsAtBeat(visibleStartBeat);
        sourceStartSeconds = Math.max(
            span.sourceStartSeconds,
            Math.min(
                span.sourceEndSeconds,
                span.sourceStartSeconds + (visibleStartSongSeconds - span.soundStartSongSeconds) * span.stretchRatio
            )
        );
    }
    let sourceEndSeconds = span.sourceEndSeconds;
    if (boundedEndSongSeconds < soundEndSongSeconds) {
        sourceEndSeconds = Math.max(
            sourceStartSeconds,
            Math.min(
                span.sourceEndSeconds,
                span.sourceStartSeconds + (boundedEndSongSeconds - span.soundStartSongSeconds) * span.stretchRatio
            )
        );
    }
    const startSample = Math.max(span.startSample, Math.floor(sourceStartSeconds * sampleRate));
    const endSample = Math.min(span.endSample, Math.ceil(sourceEndSeconds * sampleRate));
    if (endSample <= startSample) {
        return null;
    }
    return {
        ...span,
        startSample,
        endSample,
        sourceStartSeconds,
        sourceEndSeconds,
        soundStartSongSeconds: visibleStartSongSeconds,
        audibleStartBeat: visibleStartBeat,
        audibleTimelineBeats: visibleEndBeat - visibleStartBeat,
    };
}

/** One bounded uniform PCM peak window per visible actual loop occurrence. */
export function getAudioWaveformOccurrences({
    clip,
    model,
    sampleRate,
    bufferLength,
    maxBins,
}: {
    clip: ClipRenderModel;
    model: TimelineRenderModel;
    sampleRate: number;
    bufferLength: number;
    maxBins: number;
}): readonly AudioWaveformOccurrence[] {
    const timeline = model.sourceTimeline ?? flatSourceTimeline(60 / model.tempo);
    const key = layoutKey(clip, model, sampleRate, bufferLength, maxBins);
    const cached = layoutCache.get(clip);
    if (
        cached &&
        cached.timeline === model.sourceTimeline &&
        cached.programme === clip.audioProgramme &&
        cached.key === key
    ) {
        return cached.occurrences;
    }

    const occurrences: AudioWaveformOccurrence[] = [];
    const visibleStartBeat = Math.max(model.viewportStartBeat, clip.startBeat);
    const visibleEndBeat = Math.min(model.viewportEndBeat, clip.endBeat);
    for (const source of clip.audioProgramme ?? [clip]) {
        const clipBeats = source.endBeat - source.startBeat;
        const loop = projectClipLoopExpansion({
            clipDurationBeats: clipBeats,
            configuredLoopLengthBeats: source.loopLength,
            loopEnabled: source.loopEnabled ?? false,
        });
        const ratio =
            source.stretchMode && source.stretchMode !== 'off' ? boundStretchRatio(source.stretchRatio ?? 1) : 1;
        const firstIteration = Math.max(0, Math.floor((visibleStartBeat - source.startBeat) / loop.loopLengthBeats));
        const lastIteration = Math.min(
            loop.iterationCount,
            Math.ceil((visibleEndBeat - source.startBeat) / loop.loopLengthBeats)
        );
        for (let iteration = firstIteration; iteration < lastIteration; iteration++) {
            const iterationStartBeat = source.startBeat + iteration * loop.loopLengthBeats;
            const iterationEndBeat = Math.min(source.endBeat, iterationStartBeat + loop.loopLengthBeats);
            const segments = projectAudioLoopPassSegments({
                clip: { ...source },
                loopLengthBeats: loop.loopLengthBeats,
                iterationStartBeat,
                iterationEndBeat,
                stretchRatio: ratio,
                tempoAtClipStart: source.clipStartTempo ?? model.tempo,
                secondsAtBeat: timeline.secondsAtBeat,
            });
            for (const segment of segments) {
                const segmentStartBeat = iterationStartBeat + segment.startOffsetBeats;
                const segmentEndBeat = iterationStartBeat + segment.endOffsetBeats;
                const span = computeAudioWaveformDrawSpan({
                    offsetBeats: source.audioOffsetBeats ?? 0,
                    offsetSeconds: segment.sourceStartSeconds,
                    stretchRatio: ratio,
                    clipBeats: segmentEndBeat - segmentStartBeat,
                    secondsPerBeat: 60 / (source.clipStartTempo ?? model.tempo),
                    sampleRate,
                    clipStartBeat: segmentStartBeat,
                    timeline,
                    bufferLengthSamples: bufferLength,
                });
                const visibleSpan = visibleSourceWindow(
                    span,
                    timeline,
                    segmentEndBeat,
                    visibleStartBeat,
                    visibleEndBeat,
                    sampleRate
                );
                if (!visibleSpan) {
                    continue;
                }
                const numBins = Math.min(maxBins, Math.floor(visibleSpan.audibleTimelineBeats * model.pixelsPerBeat));
                if (numBins > 0) {
                    occurrences.push({ iteration: occurrences.length, span: visibleSpan, numBins });
                }
            }
        }
    }

    layoutCache.set(clip, {
        timeline: model.sourceTimeline,
        programme: clip.audioProgramme,
        key,
        occurrences,
        peakPositions: new Map(),
    });
    return occurrences;
}

/** Cached source-bin placement through the same inverse song clock as playback. */
export function getAudioWaveformPeakPositions({
    clip,
    model,
    occurrence,
    binCount,
}: {
    clip: ClipRenderModel;
    model: TimelineRenderModel;
    occurrence: AudioWaveformOccurrence;
    binCount: number;
}): Float64Array {
    const cached = layoutCache.get(clip);
    const key = `${occurrence.iteration}:${binCount}`;
    const prior = cached?.peakPositions.get(key);
    if (prior) {
        return prior;
    }
    const positions = new Float64Array(binCount + 1);
    const timeline = model.sourceTimeline ?? flatSourceTimeline(60 / model.tempo);
    const span = occurrence.span;
    for (let index = 0; index <= binCount; index++) {
        const sourceSeconds =
            span.sourceStartSeconds + ((span.sourceEndSeconds - span.sourceStartSeconds) * index) / binCount;
        const songSeconds = span.soundStartSongSeconds + (sourceSeconds - span.sourceStartSeconds) / span.stretchRatio;
        const beat = timeline.beatAtSeconds(songSeconds);
        positions[index] = (beat - model.viewportStartBeat) * model.pixelsPerBeat;
    }
    cached?.peakPositions.set(key, positions);
    return positions;
}
