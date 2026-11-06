import { trackStore } from '#/modules/Arrangement/stores';
import { prepareDuplicateClipTargetId, selectClipWithFocus } from '#/modules/Arrangement/useCases';
import { executeUserAppAction } from '#/modules/Command/useCases';

type SingleClipDuplicateType = 'duplicateClip' | 'duplicateClipToNextBar';

function clipExists(clipId: string): boolean {
    return trackStore.value?.tracks.some((track) => track.clips.some((clip) => clip.id === clipId)) ?? false;
}

/**
 * Duplicates one clip and moves the selection onto the copy, so the next press chains after it.
 *
 * The caller names the copy up front; the selection follows only when that exact clip exists
 * after the action, so a refused or conflicted duplicate leaves the source selected.
 */
export async function duplicateClipSelectingCopy(type: SingleClipDuplicateType, clipId: string): Promise<void> {
    const targetClipId = prepareDuplicateClipTargetId();
    await executeUserAppAction({ type, payload: { clipId, targetClipId } });
    if (!clipExists(targetClipId)) {
        return;
    }
    selectClipWithFocus(targetClipId);
}
