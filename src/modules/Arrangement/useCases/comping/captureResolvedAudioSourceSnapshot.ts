import { captureAudioSourceSnapshot } from '#/utils/audioSourceTime';
import { projectClipLoopExpansion } from '#/utils/clipLoopProjection';

import { type ResolvedClip } from '../../models/ResolvedClip';
import { type TempoTimeline } from '../../models/TempoTimeline';

export function captureResolvedAudioSourceSnapshot(clip: ResolvedClip, timeline: TempoTimeline) {
    const loop = projectClipLoopExpansion({
        clipDurationBeats: clip.endBeat - clip.startBeat,
        configuredLoopLengthBeats: clip.loopLength,
        loopEnabled: clip.loopEnabled ?? false,
    });
    return captureAudioSourceSnapshot(clip, loop.loopLengthBeats, timeline.tempoAtBeat(clip.startBeat));
}
