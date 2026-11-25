import { activeFreezeTasks } from './freezeTrack';
import { settleFreezingTrack } from './settleFreezingTrack';

/**
 * Stops the running freeze and settles the track in the same step. The freeze's own exit comes
 * later and at an unknown point (during the hash, or after a render that returned normally), and
 * the action that started it may be rolled back, so nothing there can be relied on to clear
 * `freezing`. A track that shows `freezing` with no running freeze is settled too.
 */
export function cancelFreezeTrack(trackId: string): void {
    activeFreezeTasks.get(trackId)?.abort();
    activeFreezeTasks.delete(trackId);
    settleFreezingTrack(trackId);
}
