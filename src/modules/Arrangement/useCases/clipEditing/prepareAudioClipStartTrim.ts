import { loopOriginEntry } from '#/utils/clipLoopOrigin';
import { hasExactAudioSourceFields } from '#/utils/hasExactAudioSourceFields';

import { type TempoTimeline } from '../../models/TempoTimeline';
import { type Clip } from '../../models/Track';
import { liveTempoTimeline } from '../liveTempoTimeline';

import { audioSourceAtBeat } from './audioSourceAtBeat';

/** Read the old head and clock before changing the visible source window. */
export function prepareAudioClipStartTrim(
    clip: Clip,
    newStartBeat: number,
    timeline: TempoTimeline = liveTempoTimeline
): Clip | null {
    if (clip.type !== 'audio' || !Number.isFinite(newStartBeat) || !hasExactAudioSourceFields(clip)) {
        return null;
    }
    const startBeat = Math.max(0, newStartBeat);
    if (startBeat >= clip.endBeat) {
        return null;
    }
    const source = audioSourceAtBeat(clip, startBeat, timeline);
    if (!source) {
        return null;
    }
    return {
        ...clip,
        ...source,
        startBeat,
        audioOffsetBeats: (clip.audioOffsetBeats ?? 0) + (startBeat - clip.startBeat),
        ...loopOriginEntry(
            clip.loopOriginBeat ?? (clip.loopEnabled && startBeat >= clip.startBeat ? clip.startBeat : undefined)
        ),
    };
}
