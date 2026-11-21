import { assertFreezeSourceUnchanged } from './assertFreezeSourceUnchanged';

/**
 * The render reads the live track list, not the track the freeze captured before its digest, so a
 * clip added while that digest was pending would be rendered; if it were removed again before the
 * commit, the final check would see the start hash. This hashes the live source now. Returns false
 * when the freeze was superseded or cancelled before or during the check, and throws when the
 * source differs. The caller reads the live source and renders synchronously afterwards.
 */
export async function confirmFreezeSourceBeforeRender<Task>(
    trackId: string,
    startSourceHash: string,
    isCurrentFreezeTask: (task: Task) => boolean,
    task: Task
): Promise<boolean> {
    if (!isCurrentFreezeTask(task)) {
        return false;
    }
    await assertFreezeSourceUnchanged(trackId, startSourceHash);
    return isCurrentFreezeTask(task);
}
