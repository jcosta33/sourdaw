import { type TakeLane } from '../../models/TakeLane';
import { collectLiveClipIds } from '../../services/collectLiveClipIds';
import { getTrackStoreState } from '../getTrackStoreState';

import { takesWithLiveClips } from './takesWithLiveClips';

/**
 * The lane as a replay may hold it: only the takes whose clips still exist, and only
 * the comp regions naming those takes.
 *
 * Both halves are filtered here, in one place, because they cannot be filtered apart:
 * a region left behind for a take the replay had to drop still advances
 * `resolveClipsWithComping`'s gap cursor over its span, so the track's own material
 * goes silent there in live playback and in the offline render while the dangling take
 * id persists in the project.
 */
export function laneWithLiveTakes(lane: TakeLane): TakeLane {
    const takes = takesWithLiveClips(lane.takes);
    const takeIds = new Set(takes.map((take) => take.id));
    const liveClipIds = collectLiveClipIds(getTrackStoreState()?.tracks ?? []);
    const next = {
        ...lane,
        takes,
        activeCompRegions: lane.activeCompRegions.filter((region) => takeIds.has(region.takeId)),
    };
    if (lane.baseGapAudioSources !== undefined) {
        next.baseGapAudioSources = lane.baseGapAudioSources.filter((tile) => liveClipIds.has(tile.clipId));
    }
    return next;
}
