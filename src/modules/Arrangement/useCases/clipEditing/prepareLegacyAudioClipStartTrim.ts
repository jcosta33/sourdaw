import { loopOriginEntry } from '#/utils/clipLoopOrigin';
import { hasExactAudioSourceFields } from '#/utils/hasExactAudioSourceFields';

import { type Clip } from '../../models/Track';

/** The old beat-only forward law; it supplies no physical-source provenance. */
export function prepareLegacyAudioClipStartTrim(
    clip: Clip,
    newStartBeat: number,
    restoredAnchor?: number | null
): Clip | null {
    if (
        clip.type !== 'audio' ||
        !Number.isFinite(newStartBeat) ||
        Object.hasOwn(clip, 'audioOffsetSeconds') ||
        !hasExactAudioSourceFields(clip)
    ) {
        return null;
    }
    const startBeat = Math.max(0, newStartBeat);
    if (startBeat >= clip.endBeat) {
        return null;
    }
    let anchor = restoredAnchor;
    if (anchor === undefined) {
        anchor = clip.loopOriginBeat ?? (clip.loopEnabled && startBeat >= clip.startBeat ? clip.startBeat : undefined);
    }
    const delta = startBeat - clip.startBeat;
    const after = {
        ...clip,
        startBeat,
        audioOffsetBeats: (clip.audioOffsetBeats ?? 0) + delta,
        ...loopOriginEntry(anchor === null ? undefined : anchor),
    };
    if (anchor === null) {
        delete after.loopOriginBeat;
    }
    return after;
}
