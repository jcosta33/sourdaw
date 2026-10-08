import { type AudioSourceStateSnapshot } from '#/utils/handlerContract';

import { type Clip } from '../../models/Track';
import { updateClip } from '../updateClip';

import { audioSourceAfterSlip } from './audioSourceAfterSlip';
import { isAudioSourceStateSnapshot } from './isAudioSourceStateSnapshot';

/**
 * Slip clip content — slides internal content (audio or MIDI) within fixed boundaries.
 * Non-destructive: adjusts audioOffsetBeats (audio) or midiOffsetBeats (MIDI).
 * Note data and clip boundaries are untouched. Reports whether the write landed.
 */
export function slipClipContent(
    clipId: string,
    type: 'audio' | 'midi',
    newOffset: number,
    offsetSeconds?: number,
    restoreAudioSource?: AudioSourceStateSnapshot
): boolean {
    if (
        !Number.isFinite(newOffset) ||
        (offsetSeconds !== undefined && !Number.isFinite(offsetSeconds)) ||
        (restoreAudioSource && !isAudioSourceStateSnapshot(restoreAudioSource))
    ) {
        return false;
    }
    return updateClip(clipId, (context) => {
        if (type === 'audio') {
            const source = audioSourceAfterSlip(context, newOffset, offsetSeconds);
            const updated: Clip = { ...context, ...source };
            if (restoreAudioSource) {
                delete updated.audioOffsetSeconds;
                delete updated.audioOffsetBeats;
                if (restoreAudioSource.audioOffsetSeconds !== null) {
                    updated.audioOffsetSeconds = restoreAudioSource.audioOffsetSeconds;
                }
                if (restoreAudioSource.audioOffsetBeats !== null) {
                    updated.audioOffsetBeats = restoreAudioSource.audioOffsetBeats;
                }
            }
            return updated;
        }
        return { ...context, midiOffsetBeats: newOffset };
    });
}
