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
        endSample: Math.max(0, Math.floor(sourceEndSeconds * sampleRate)),
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
    const audibleEndBeat = timeline.beatAtSeconds(
        span.soundStartSongSeconds + (span.sourceEndSeconds - span.sourceStartSeconds) / span.stretchRatio
    );
    const visibleStartBeat = Math.max(span.audibleStartBeat, viewportStartBeat);
    const visibleEndBeat = Math.min(iterationEndBeat, audibleEndBeat, viewportEndBeat);
    if (visibleEndBeat <= visibleStartBeat) {
        return null;
    }

    const visibleStartSongSeconds = timeline.secondsAtBeat(visibleStartBeat);
    const visibleEndSongSeconds = timeline.secondsAtBeat(visibleEndBeat);
    const sourceStartSeconds = Math.max(
        span.sourceStartSeconds,
        Math.min(
            span.sourceEndSeconds,
            span.sourceStartSeconds + (visibleStartSongSeconds - span.soundStartSongSeconds) * span.stretchRatio
        )
    );
    const sourceEndSeconds = Math.max(
        sourceStartSeconds,
        Math.min(
            span.sourceEndSeconds,
            span.sourceStartSeconds + (visibleEndSongSeconds - span.soundStartSongSeconds) * span.stretchRatio
        )
    );
    const startSample = Math.max(span.startSample, Math.floor(sourceStartSeconds * sampleRate));
    const endSample = Math.min(span.endSample, Math.floor(sourceEndSeconds * sampleRate));
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
    if (cached && cached.timeline === model.sourceTimeline && cached.key === key) {
        return cached.occurrences;
    }

    const clipBeats = clip.endBeat - clip.startBeat;
    const loop = projectClipLoopExpansion({
        clipDurationBeats: clipBeats,
        configuredLoopLengthBeats: clip.loopLength,
        loopEnabled: clip.loopEnabled ?? false,
    });
    const ratio = clip.stretchMode && clip.stretchMode !== 'off' ? boundStretchRatio(clip.stretchRatio ?? 1) : 1;
    const occurrences: AudioWaveformOccurrence[] = [];
    const firstIteration = Math.max(0, Math.floor((model.viewportStartBeat - clip.startBeat) / loop.loopLengthBeats));
    const lastIteration = Math.min(
        loop.iterationCount,
        Math.ceil((model.viewportEndBeat - clip.startBeat) / loop.loopLengthBeats)
    );
    for (let iteration = firstIteration; iteration < lastIteration; iteration++) {
        const iterationStartBeat = clip.startBeat + iteration * loop.loopLengthBeats;
        const iterationEndBeat = Math.min(clip.endBeat, iterationStartBeat + loop.loopLengthBeats);
        const segments = projectAudioLoopPassSegments({
            clip: { ...clip },
            loopLengthBeats: loop.loopLengthBeats,
            iterationStartBeat,
            iterationEndBeat,
            stretchRatio: ratio,
            tempoAtClipStart: clip.clipStartTempo ?? model.tempo,
            secondsAtBeat: timeline.secondsAtBeat,
        });
        for (const segment of segments) {
            const segmentStartBeat = iterationStartBeat + segment.startOffsetBeats;
            const segmentEndBeat = iterationStartBeat + segment.endOffsetBeats;
            const span = computeAudioWaveformDrawSpan({
                offsetBeats: clip.audioOffsetBeats ?? 0,
                offsetSeconds: segment.sourceStartSeconds,
                stretchRatio: ratio,
                clipBeats: segmentEndBeat - segmentStartBeat,
                secondsPerBeat: 60 / (clip.clipStartTempo ?? model.tempo),
                sampleRate,
                clipStartBeat: segmentStartBeat,
                timeline,
                bufferLengthSamples: bufferLength,
            });
            const visibleSpan = visibleSourceWindow(
                span,
                timeline,
                segmentEndBeat,
                model.viewportStartBeat,
                model.viewportEndBeat,
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

    layoutCache.set(clip, { timeline: model.sourceTimeline, key, occurrences, peakPositions: new Map() });
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
