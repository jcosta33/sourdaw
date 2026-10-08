import { pushUndoEntry, REDO_NOT_APPLIED } from '#/modules/Command/useCases';
import { type RetiredTakeLaneSnapshot } from '#/utils/handlerContract';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { applyPreparedClipSplit } from './applyPreparedClipSplit';
import { prepareClipSplit } from './prepareClipSplit';
import { restoreClipSplitState } from './restoreClipSplitState';

export function splitClipWithUndo(clipId: string, splitBeat: number): void {
    const plan = prepareClipSplit({ clipId, splitBeat });
    if (!plan) {
        return;
    }
    if (!applyPreparedClipSplit(plan)) {
        return;
    }
    const rightClipId = plan.rightClipId;
    const retiredTakeLanes: RetiredTakeLaneSnapshot[] = [];
    pushUndoEntry(
        'Split clip',
        () => {
            if (
                !restoreClipSplitState({
                    clipId,
                    rightClipId,
                    expected: plan.next,
                    replacement: plan.previous,
                    retiredTakeLanes,
                })
            ) {
                throw new Error('Cannot undo split clip: project state has changed');
            }
        },
        () => {
            if (
                !restoreClipSplitState({
                    clipId,
                    rightClipId,
                    expected: plan.previous,
                    replacement: plan.next,
                    retiredTakeLanes,
                })
            ) {
                notifyUser('Failed to redo split clip - the clip state has changed', 'error');
                return REDO_NOT_APPLIED;
            }
            return rightClipId;
        }
    );
}
