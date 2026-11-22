import { projectAudioLoopPassSegments, resolveAudioSourceOffsetSeconds } from '#/utils/audioSourceTime';
import { projectClipLoopExpansion } from '#/utils/clipLoopProjection';
import { boundStretchRatio } from '#/utils/stretchRatioBound';

export type SourceSpanBeats = { startBeats: number; endBeats: number };

type AudibleClip = Parameters<typeof resolveAudioSourceOffsetSeconds>[0] &
    Parameters<typeof projectAudioLoopPassSegments>[0]['clip'] & {
        endBeat: number;
        loopLength?: number;
        clipStartTempo?: number;
        stretchMode?: string;
        stretchRatio?: number;
    };

// Same gate and bound playback applies (`scheduleAudioClips`, `audioWaveformSpan`): an off clip
// ignores its stored ratio.
export function resolvePlaybackStretchRatio(clip: Pick<AudibleClip, 'stretchMode' | 'stretchRatio'> | null): number {
    if (!clip?.stretchMode || clip.stretchMode === 'off') {
        return 1;
    }
    return boundStretchRatio(clip.stretchRatio ?? 1);
}

function mergeSpans(spans: readonly SourceSpanBeats[]): SourceSpanBeats[] {
    const merged: SourceSpanBeats[] = [];
    for (const span of [...spans].sort((a, b) => a.startBeats - b.startBeats)) {
        const last = merged[merged.length - 1];
        if (last && span.startBeats <= last.endBeats) {
            last.endBeats = Math.max(last.endBeats, span.endBeats);
        } else {
            merged.push({ startBeats: span.startBeats, endBeats: span.endBeats });
        }
    }
    return merged;
}

/**
 * The source ranges (in file beats at the project tempo) the clip plays: the union of every loop pass
 * the scheduler projects. An unlooped clip is one range from its offset, `ratio` source beats per beat.
 */
export function resolveAudibleSourceSpans(clip: AudibleClip | null, tempo: number): SourceSpanBeats[] {
    if (!clip) {
        return [];
    }
    const ratio = resolvePlaybackStretchRatio(clip);
    const clipBeats = clip.endBeat - clip.startBeat;
    const offsetBeats = (resolveAudioSourceOffsetSeconds(clip, tempo) * tempo) / 60;
    const single = [{ startBeats: offsetBeats, endBeats: offsetBeats + clipBeats * ratio }];
    if (!clip.loopEnabled) {
        return single;
    }
    const loop = projectClipLoopExpansion({
        clipDurationBeats: clipBeats,
        configuredLoopLengthBeats: clip.loopLength,
        loopEnabled: true,
    });
    const spans: SourceSpanBeats[] = [];
    for (let iteration = 0; iteration < loop.iterationCount; iteration++) {
        const iterationStartBeat = clip.startBeat + iteration * loop.loopLengthBeats;
        const segments = projectAudioLoopPassSegments({
            clip,
            loopLengthBeats: loop.loopLengthBeats,
            iterationStartBeat,
            iterationEndBeat: Math.min(clip.endBeat, iterationStartBeat + loop.loopLengthBeats),
            stretchRatio: ratio,
            tempoAtClipStart: clip.clipStartTempo ?? tempo,
            secondsAtBeat: (beat) => (beat * 60) / tempo,
        });
        for (const segment of segments) {
            const startBeats = (segment.sourceStartSeconds * tempo) / 60;
            spans.push({
                startBeats,
                endBeats: startBeats + (segment.endOffsetBeats - segment.startOffsetBeats) * ratio,
            });
        }
    }
    return spans.length > 0 ? mergeSpans(spans) : single;
}
