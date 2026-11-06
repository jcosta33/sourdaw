import { getTrackState } from '../../repositories/track/getTrackState';
import { findClipById } from '../../services/findClipById';

import { limitClipEndToSource } from './limitClipEndToSource';

/**
 * The farthest end a user may give the clip `clipId` by moving its end, or
 * `null` when nothing but the editor's own range limits it: the clip is gone,
 * loops, is MIDI, or its decoded source is not cached. Controls that set an end
 * directly take their maximum from here, so they stop where the timeline edge
 * stops.
 */
export function getClipEndLimit(clipId: string): number | null {
    const found = findClipById({ clipId, tracks: getTrackState()?.tracks ?? [] });
    if (!found) {
        return null;
    }
    const limit = limitClipEndToSource(found.clip, Number.POSITIVE_INFINITY);
    return Number.isFinite(limit) ? limit : null;
}
