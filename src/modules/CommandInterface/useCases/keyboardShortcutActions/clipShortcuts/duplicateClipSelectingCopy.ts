import { logger } from '#/infra/logger/appLogger';
import { trackStore } from '#/modules/Arrangement/stores';
import { prepareDuplicateClipTargetId, selectClipWithFocus } from '#/modules/Arrangement/useCases';
import { executeUserAppAction, isAppActionCommittedError } from '#/modules/Command/useCases';

type SingleClipDuplicateType = 'duplicateClip' | 'duplicateClipToNextBar';

type DuplicateAuthority = {
    shouldExecute: () => boolean;
    onSelected: () => void;
};

function clipExists(clipId: string): boolean {
    return trackStore.value?.tracks.some((track) => track.clips.some((clip) => clip.id === clipId)) ?? false;
}

/** The preallocated copy is the commit witness; a void dispatch is not. */
export async function duplicateClipSelectingCopy(
    type: SingleClipDuplicateType,
    clipId: string,
    authority?: DuplicateAuthority
): Promise<boolean> {
    const targetClipId = prepareDuplicateClipTargetId();
    try {
        await executeUserAppAction(
            { type, payload: { clipId, targetClipId } },
            authority ? { shouldExecute: authority.shouldExecute, shouldCommit: authority.shouldExecute } : undefined
        );
    } catch (error) {
        if (!isAppActionCommittedError(error)) {
            throw error;
        }
        // The mutation already committed. Report the failure without dispatching it again.
        logger.error(error);
    }
    if ((authority && !authority.shouldExecute()) || !clipExists(targetClipId)) {
        return false;
    }
    selectClipWithFocus(targetClipId);
    authority?.onSelected();
    return true;
}
