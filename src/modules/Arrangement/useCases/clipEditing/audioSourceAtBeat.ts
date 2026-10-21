import { readSecondsAtBeat, readTempoAtBeat } from '#/modules/Transport/stores';
import {
    getAudioSourcePositionSeconds,
    resolveAudioSourceOffsetSeconds,
    resolveAudioLoopStartSeconds,
    projectAudioLoopPassSegments,
} from '#/utils/audioSourceTime';
import { projectClipLoopExpansion } from '#/utils/clipLoopProjection';

import { type Clip } from '../../models/Track';
import { consumedStretchFactor } from './consumedStretchFactor';

type SourceClip = Pick<
    Clip,
    | 'startBeat'
    | 'endBeat'
    | 'audioOffsetSeconds'
    | 'audioOffsetBeats'
    | 'audioLoopStartSeconds'
    | 'loopEnabled'
    | 'loopLength'
    | 'loopOriginBeat'
    | 'stretchMode'
    | 'stretchRatio'
>;
export function audioSourceAtBeat(
    clip: SourceClip,
    beat: number
): { audioOffsetSeconds: number; audioOffsetBeats: number; audioLoopStartSeconds?: number } {
    const tempo = readTempoAtBeat({ beat: clip.startBeat });
    const rate = consumedStretchFactor(clip);
    const secondsAtBeat = (at: number) => readSecondsAtBeat({ beat: at });
    let sourceSeconds = getAudioSourcePositionSeconds(
        resolveAudioSourceOffsetSeconds(clip, tempo),
        secondsAtBeat(beat) - secondsAtBeat(clip.startBeat),
        rate
    );
    if (clip.loopEnabled && beat >= clip.startBeat) {
        const loop = projectClipLoopExpansion({
            clipDurationBeats: clip.endBeat - clip.startBeat,
            configuredLoopLengthBeats: clip.loopLength,
            loopEnabled: true,
        });
        const iterationStartBeat =
            clip.startBeat + Math.floor((beat - clip.startBeat) / loop.loopLengthBeats) * loop.loopLengthBeats;
        const segments = projectAudioLoopPassSegments({
            clip,
            loopLengthBeats: loop.loopLengthBeats,
            iterationStartBeat,
            iterationEndBeat: iterationStartBeat + loop.loopLengthBeats,
            stretchRatio: rate,
            tempoAtClipStart: tempo,
            secondsAtBeat,
        });
        const segment = segments.find((item) => beat < iterationStartBeat + item.endOffsetBeats) ?? segments.at(-1);
        if (segment) {
            sourceSeconds = getAudioSourcePositionSeconds(
                segment.sourceStartSeconds,
                secondsAtBeat(beat) - secondsAtBeat(iterationStartBeat + segment.startOffsetBeats),
                rate
            );
        }
    }
    return {
        audioOffsetSeconds: sourceSeconds,
        audioOffsetBeats: (sourceSeconds * readTempoAtBeat({ beat })) / 60,
        ...(clip.loopEnabled ? { audioLoopStartSeconds: resolveAudioLoopStartSeconds(clip, tempo) } : {}),
    };
}
