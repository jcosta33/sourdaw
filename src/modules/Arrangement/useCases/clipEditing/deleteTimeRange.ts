import { pushUndoEntry, REDO_NOT_APPLIED } from '#/modules/Command/useCases';

import { collectTimeOperationPlanBufferIds } from '../timeOperations/collectTimeOperationPlanBufferIds';

import { executeSelectedTimeRangeDeletion } from './executeSelectedTimeRangeDeletion';

export function deleteTimeRange(startBeat: number, endBeat: number, trackIds: string[]): void {
    const request = {
        startBeat,
        endBeat,
        trackIds: [...trackIds],
    };
    const result = executeSelectedTimeRangeDeletion(request);
    if (result.status !== 'applied') {
        return;
    }

    const replayPlan = result.replayPlan;
    let activeTransaction = result;
    // The callback closures flip whole track states, so the undo history must
    // know which audio buffers they can bring back (the deleted clips travel in
    // the encoded plan's replacement state).
    const restoresBufferIds = collectTimeOperationPlanBufferIds(result.inversePlan);
    pushUndoEntry(
        'Delete Time Range',
        () => {
            if (!activeTransaction.undo()) {
                throw new Error('Delete Time Range undo was not applied');
            }
        },
        () => {
            const replay = executeSelectedTimeRangeDeletion({
                ...request,
                replayPlan,
            });
            if (replay.status !== 'applied') {
                return REDO_NOT_APPLIED;
            }
            activeTransaction = replay;
            return undefined;
        },
        { restoresBufferIds }
    );
}
