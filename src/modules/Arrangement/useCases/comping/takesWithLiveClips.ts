import { type Take } from '../../models/TakeLane';
import { collectTrackClipIds } from '../../services/collectTrackClipIds';
import { getTrackStoreState } from '../getTrackStoreState';

/**
 * The takes whose clips are still in the project, in their original order.
 *
 * A take whose clip is gone has no material to resolve against: writing it back
 * leaves a take naming a clip that exists nowhere — the orphan this retirement work
 * exists to prevent, with a comp resolver free to advance on it. Every path that
 * replays captured take state filters through here, whether it is putting a removal
 * back (`restoreTakesForClip`) or replaying a take-lane history entry
 * (`takeLaneUndo`), so the rule cannot drift between them.
 */
export function takesWithLiveClips(takes: readonly Take[]): Take[] {
    const tracks = getTrackStoreState()?.tracks ?? [];
    return takes.filter((take) => tracks.some((track) => collectTrackClipIds(track).includes(take.clipId)));
}
