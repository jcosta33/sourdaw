import { readSecondsAtBeat, readTempoAtBeat } from '#/modules/Transport/stores';
import { captureAudioSourceState, projectAudioLoopPassSegments } from '#/utils/audioSourceTime';
import { projectClipLoopExpansion } from '#/utils/clipLoopProjection';

import { type Clip } from '../../models/Track';
import { consumedStretchFactor } from './consumedStretchFactor';

type SourceClip = Pick<
    Clip,
    | 'startBeat'
    | 'endBeat'
    | 'audioOffsetSeconds'
    | 'audioUnwrappedOffsetSeconds'
    | 'audioOffsetBeats'
    | 'audioLoopStartSeconds'
    | 'audioLoopPassEntrySeconds'
    | 'audioLoopPassOriginBeat'
    | 'loopEnabled'
    | 'loopLength'
    | 'loopOriginBeat'
    | 'stretchMode'
    | 'stretchRatio'
>;

/** A cut captures its actual entry but retains the original repeat grid and source anchors. */
export function audioSourceAtBeat(clip: SourceClip, beat: number) {
    const tempo = readTempoAtBeat({ beat: clip.startBeat });
    const loop = projectClipLoopExpansion({
        clipDurationBeats: clip.endBeat - clip.startBeat,
        configuredLoopLengthBeats: clip.loopLength,
        loopEnabled: clip.loopEnabled ?? false,
    });
    const source = captureAudioSourceState(clip, loop.loopLengthBeats, tempo);
    if (!source) return null;
    const segment = projectAudioLoopPassSegments({
        clip,
        loopLengthBeats: loop.loopLengthBeats,
        iterationStartBeat: beat,
        iterationEndBeat: beat + loop.loopLengthBeats,
        stretchRatio: consumedStretchFactor(clip),
        tempoAtClipStart: tempo,
        secondsAtBeat: (at) => readSecondsAtBeat({ beat: at }),
    })[0];
    if (!segment) return null;
    return {
        ...source,
        audioOffsetSeconds: segment.sourceStartSeconds,
        // Unplaced take entry advances without rate; placed takes retain their own origin pair.
        audioUnwrappedOffsetSeconds:
            source.audioUnwrappedOffsetSeconds +
            readSecondsAtBeat({ beat }) -
            readSecondsAtBeat({ beat: clip.startBeat }),
        ...(clip.loopEnabled ? { loopLength: loop.loopLengthBeats } : {}),
    };
}
