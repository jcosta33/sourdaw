import { type Track } from '../../stores/trackStore';

import { assertFreezeSourceUnchanged } from './assertFreezeSourceUnchanged';

/**
 * The render reads the live track list, not the track the freeze captured before its digest, so a
 * clip added while that digest was pending would be rendered; if it were removed again before the
 * commit, the final check would see the start hash. This hashes the live sources now and returns
 * the live source tracks it hashed. It returns null when the freeze was superseded or cancelled before or
 * during the check, and throws when the source differs.
 *
 * Settling the returned promise still takes microtask turns after the last live read, so the
 * caller must run `assertRenderReadsHashedTrack` synchronously before the render call.
 */
export async function confirmFreezeSourceBeforeRender<Task>(
    trackId: string,
    startSourceHash: string,
    isCurrentFreezeTask: (task: Task) => boolean,
    task: Task
): Promise<Track[] | null> {
    if (!isCurrentFreezeTask(task)) {
        return null;
    }
    const hashedSources = await assertFreezeSourceUnchanged(trackId, startSourceHash);
    return isCurrentFreezeTask(task) ? hashedSources : null;
}
