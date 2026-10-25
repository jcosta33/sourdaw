import { audioSourceSnapshotAtBeat, captureAudioSourceSnapshot } from '#/utils/audioSourceTime';
import { boundStretchRatio } from '#/utils/stretchRatioBound';
import { resolveLoopAnchoredStartBeat } from '#/utils/clipLoopOrigin';

import { type TempoTimeline } from '../../models/TempoTimeline';
import { type ResolvedClip } from '../../models/ResolvedClip';
import { type Clip } from '../../models/Track';

import { clipMediaOffsetAt } from '../clipMediaOffsetAt';
import { withMediaOffsetBeats } from '../withMediaOffsetBeats';

/** The actual base-gap window producer, also used to authenticate support conversions. */
export function resolveCompBaseGapWindow(
    clip: Clip,
    window: {
        readonly startBeat: number;
        readonly endBeat: number;
        readonly audioSource?: import('#/utils/audioSourceTime').AudioSourceSnapshot;
    },
    timeline: TempoTimeline
): ResolvedClip {
    const rate = clip.stretchMode && clip.stretchMode !== 'off' ? boundStretchRatio(clip.stretchRatio ?? 1) : 1;
    let snapshot = window.audioSource ?? null;
    if (snapshot === null && clip.type === 'audio' && clip.audioOffsetSeconds !== undefined) {
        snapshot = captureAudioSourceSnapshot(
            clip,
            clip.loopLength ?? clip.endBeat - clip.startBeat,
            timeline.tempoAtBeat(clip.startBeat)
        );
    }
    let source: ReturnType<typeof audioSourceSnapshotAtBeat> = null;
    if (snapshot) {
        source = audioSourceSnapshotAtBeat(
            snapshot,
            window.startBeat,
            rate,
            clip.loopEnabled ?? false,
            timeline.secondsAtBeat
        );
    }
    return {
        ...withMediaOffsetBeats(clip, clipMediaOffsetAt(clip, window.startBeat, timeline)),
        ...source,
        startBeat: window.startBeat,
        endBeat: window.endBeat,
        regionStartBeat: window.startBeat,
        regionEndBeat: window.endBeat,
        sourceStartBeat: resolveLoopAnchoredStartBeat({
            startBeat: clip.startBeat,
            loopOriginBeat: clip.loopOriginBeat,
            loopEnabled: clip.loopEnabled ?? false,
        }),
    };
}
