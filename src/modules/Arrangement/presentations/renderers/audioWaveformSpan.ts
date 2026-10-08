import { beatAtSeconds, secondsBetweenBeats } from '#/modules/Transport/useCases';
import { resolveAudioSourceOffsetSeconds } from '#/utils/audioSourceTime';
import { projectClipLoopExpansion } from '#/utils/clipLoopProjection';
import { boundStretchRatio } from '#/utils/stretchRatioBound';

import type { ClipRenderModel, TimelineRenderModel } from '../../models/TimelineRenderModel';

type TempoChanges = NonNullable<TimelineRenderModel['tempoChanges']>;

const EMPTY_TEMPO_CHANGES: TempoChanges = [];

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
    tempoChanges = EMPTY_TEMPO_CHANGES,
    baseTempo = 60 / secondsPerBeat,
    bufferLengthSamples,
}: {
    offsetBeats: number;
    offsetSeconds?: number;
    stretchRatio: number;
    clipBeats: number;
    secondsPerBeat: number;
    sampleRate: number;
    clipStartBeat?: number;
    tempoChanges?: TempoChanges;
    baseTempo?: number;
    bufferLengthSamples?: number;
}): AudioWaveformDrawSpan {
    const ratio = boundStretchRatio(stretchRatio);
    const sourceOffsetSeconds = resolveAudioSourceOffsetSeconds(
        { audioOffsetSeconds: offsetSeconds, audioOffsetBeats: offsetBeats },
        60 / secondsPerBeat
    );
    const sourceStartSeconds = Math.max(0, sourceOffsetSeconds);
    const sourceLimitSeconds = bufferLengthSamples === undefined ? Infinity : bufferLengthSamples / sampleRate;
    const iterationStartSeconds = secondsBetweenBeats(tempoChanges, 0, clipStartBeat, baseTempo);
    const iterationDurationSeconds = secondsBetweenBeats(
        tempoChanges,
        clipStartBeat,
        clipStartBeat + clipBeats,
        baseTempo
    );
    const preRollSeconds = Math.max(0, -sourceOffsetSeconds) / ratio;
    const soundStartSongSeconds = iterationStartSeconds + preRollSeconds;
    const audibleStartBeat = beatAtSeconds(tempoChanges, soundStartSongSeconds, baseTempo);
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
    changes: TempoChanges;
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
    changes: TempoChanges,
    baseTempo: number,
    iterationEndBeat: number,
    viewportStartBeat: number,
    viewportEndBeat: number,
    sampleRate: number
): AudioWaveformDrawSpan | null {
    const audibleEndBeat = beatAtSeconds(
        changes,
        span.soundStartSongSeconds + (span.sourceEndSeconds - span.sourceStartSeconds) / span.stretchRatio,
        baseTempo
    );
    const visibleStartBeat = Math.max(span.audibleStartBeat, viewportStartBeat);
    const visibleEndBeat = Math.min(iterationEndBeat, audibleEndBeat, viewportEndBeat);
    if (visibleEndBeat <= visibleStartBeat) {
        return null;
    }

    const visibleStartSongSeconds = secondsBetweenBeats(changes, 0, visibleStartBeat, baseTempo);
    const visibleEndSongSeconds = secondsBetweenBeats(changes, 0, visibleEndBeat, baseTempo);
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
    const changes = model.tempoChanges ?? EMPTY_TEMPO_CHANGES;
    const key = layoutKey(clip, model, sampleRate, bufferLength, maxBins);
    const cached = layoutCache.get(clip);
    if (cached?.changes === changes && cached.key === key) {
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
        const span = computeAudioWaveformDrawSpan({
            offsetBeats: clip.audioOffsetBeats ?? 0,
            offsetSeconds: clip.audioOffsetSeconds,
            stretchRatio: ratio,
            clipBeats: iterationEndBeat - iterationStartBeat,
            secondsPerBeat: 60 / (clip.clipStartTempo ?? model.tempo),
            sampleRate,
            clipStartBeat: iterationStartBeat,
            tempoChanges: changes,
            baseTempo: model.tempo,
            bufferLengthSamples: bufferLength,
        });
        const visibleSpan = visibleSourceWindow(
            span,
            changes,
            model.tempo,
            iterationEndBeat,
            model.viewportStartBeat,
            model.viewportEndBeat,
            sampleRate
        );
        if (!visibleSpan) {
            continue;
        }
        const numBins = Math.min(maxBins, Math.floor(visibleSpan.audibleTimelineBeats * model.pixelsPerBeat));
        if (numBins > 0) {
            occurrences.push({ iteration, span: visibleSpan, numBins });
        }
    }

    layoutCache.set(clip, { changes, key, occurrences, peakPositions: new Map() });
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
    const changes = model.tempoChanges ?? EMPTY_TEMPO_CHANGES;
    const span = occurrence.span;
    for (let index = 0; index <= binCount; index++) {
        const sourceSeconds =
            span.sourceStartSeconds + ((span.sourceEndSeconds - span.sourceStartSeconds) * index) / binCount;
        const songSeconds = span.soundStartSongSeconds + (sourceSeconds - span.sourceStartSeconds) / span.stretchRatio;
        const beat = beatAtSeconds(changes, songSeconds, model.tempo);
        positions[index] = (beat - model.viewportStartBeat) * model.pixelsPerBeat;
    }
    cached?.peakPositions.set(key, positions);
    return positions;
}
