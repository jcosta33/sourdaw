import { captureAudioSourceState, projectAudioLoopPassSegments } from '#/utils/audioSourceTime';
import { projectClipLoopExpansion } from '#/utils/clipLoopProjection';

import { type Clip } from '../../models/Track';
import { type TempoTimeline } from '../../models/TempoTimeline';
import { liveTempoTimeline } from '../liveTempoTimeline';
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
export function audioSourceAtBeat(clip: SourceClip, beat: number, timeline: TempoTimeline = liveTempoTimeline) {
    const tempo = timeline.tempoAtBeat(clip.startBeat);
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
        secondsAtBeat: timeline.secondsAtBeat,
    })[0];
    if (!segment) return null;
    return {
        ...source,
        audioOffsetSeconds: segment.sourceStartSeconds,
        // Unplaced take entry advances without rate; placed takes retain their own origin pair.
        audioUnwrappedOffsetSeconds:
            source.audioUnwrappedOffsetSeconds + timeline.secondsAtBeat(beat) - timeline.secondsAtBeat(clip.startBeat),
        ...(clip.loopEnabled ? { loopLength: loop.loopLengthBeats } : {}),
    };
}
