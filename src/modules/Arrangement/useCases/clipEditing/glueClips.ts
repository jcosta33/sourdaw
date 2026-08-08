import { prepareClipGlue } from './prepareClipGlue';
import { restoreClipGlueState } from './restoreClipGlueState';

export function glueClips(clipIds: string[], targetClipId?: string): boolean {
    if (!Array.isArray(clipIds)) {
        return false;
    }
    const plan = prepareClipGlue({ clipIds, targetClipId });
    return plan ? restoreClipGlueState({ expected: plan.previous, replacement: plan.next }) : false;
}
