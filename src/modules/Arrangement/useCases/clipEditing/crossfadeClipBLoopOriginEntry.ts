import { shiftLoopOriginEntry } from '#/utils/clipLoopOrigin';

import { type Clip } from '../../models/Track';

/**
 * The loop anchor after clip B's start moves by `clipBDelta` while its legacy
 * offset moves by `contentDelta`. A canonical clock keeps its own repeat grid
 * (pass origin against anchor), so its anchor stays.
 */
export function crossfadeClipBLoopOriginEntry(clipB: Clip, clipBDelta: number, contentDelta: number) {
    if (clipB.type !== 'audio' || clipB.audioOffsetSeconds !== undefined) {
        return {};
    }
    return shiftLoopOriginEntry(clipB, clipBDelta - contentDelta);
}
