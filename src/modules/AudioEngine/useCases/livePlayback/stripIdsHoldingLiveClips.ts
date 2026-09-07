import { type Track } from '#/modules/Arrangement/stores';

import { resolveTrackClipsWithComping } from '../offlineRender/resolveTrackClipsWithComping';

import { isLiveClip } from './isLiveClip';

/**
 * The track strips holding live clips, over the comped clip set
 * `projectLiveGraphProgramme` itself reads.
 *
 * `readLiveGraphProgramme` answers an unconfigured clock with an empty
 * programme, and an empty programme that named no web-voiced strip would tell
 * the carrier law a project with clips on it has nothing to sound anywhere —
 * which is how a strip gets carried natively over material nothing native
 * plays. With no native playback projected at all, every strip holding a live
 * clip is one Web Audio alone voices.
 */
export function stripIdsHoldingLiveClips(stripTracks: readonly Track[]): ReadonlySet<string> {
    const stripIds = new Set<string>();
    for (const track of stripTracks) {
        // A bus sums rather than plays, the same reason the programme producer
        // skips one before it ever reaches a clip.
        if (track.kind === 'bus') {
            continue;
        }
        if (resolveTrackClipsWithComping(track.id, track.clips).some(isLiveClip)) {
            stripIds.add(track.id);
        }
    }
    return stripIds;
}
