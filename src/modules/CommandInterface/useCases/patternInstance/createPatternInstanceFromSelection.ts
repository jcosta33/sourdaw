import { logger } from '#/infra/logger/appLogger';
import { clipSelectionStore, trackStore } from '#/modules/Arrangement/stores';
import { prepareDuplicateClipTargetId, selectClipWithFocus } from '#/modules/Arrangement/useCases';
import { executeUserAppAction, isAppActionCommittedError } from '#/modules/Command/useCases';
import { captureProjectIdentity } from '#/modules/CrdtDocument/stores';

import { getSelectedClipId } from '../selectionHelpers/getSelectedClipId';

/** Select only the preallocated copy witnessed in the same project and selection. */
export async function createPatternInstanceFromSelection(): Promise<boolean> {
    const sourceClipId = getSelectedClipId();
    if (!sourceClipId) {
        return false;
    }
    const owner = trackStore.value?.tracks.find((track) => track.clips.some((clip) => clip.id === sourceClipId));
    const source = owner?.clips.find((clip) => clip.id === sourceClipId);
    if (!owner || !source || source.type !== 'midi') {
        return false;
    }
    const targetClipId = prepareDuplicateClipTargetId();
    const projectIdentity = captureProjectIdentity();
    const selection = clipSelectionStore.value;
    const ownsInvocation = () => captureProjectIdentity() === projectIdentity && clipSelectionStore.value === selection;
    try {
        await executeUserAppAction(
            {
                type: 'createPatternInstance',
                payload: { sourceClipId, targetTrackId: owner.id, startBeat: source.endBeat, targetClipId },
            },
            { shouldExecute: ownsInvocation, shouldCommit: ownsInvocation }
        );
    } catch (error) {
        if (!isAppActionCommittedError(error)) {
            throw error;
        }
        // A committed post-effect failure must never dispatch this creation twice.
        logger.error(error);
    }
    if (
        !ownsInvocation() ||
        !trackStore.value?.tracks.some((track) => track.clips.some((clip) => clip.id === targetClipId))
    ) {
        return false;
    }
    selectClipWithFocus(targetClipId);
    return true;
}
