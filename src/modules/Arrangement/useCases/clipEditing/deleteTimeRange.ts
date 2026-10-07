import { pushUndoEntry, REDO_NOT_APPLIED } from '#/modules/Command/useCases';

import { collectTimeOperationPlanBufferIds } from '../timeOperations/collectTimeOperationPlanBufferIds';
import { prepareTimeOperationStateRestore } from '../timeOperations/prepareTimeOperationStateRestore';

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
    // Deleted clips travel in the inverse plan, so history must retain their buffers.
    const restoresBufferIds = collectTimeOperationPlanBufferIds(result.inversePlan);
    pushUndoEntry(
        'Delete Time Range',
        () => {
            // CRDT settlement may replace references without changing project values.
            // Prepare at replay time; exact references still guard this publication.
            if (!prepareTimeOperationStateRestore(activeTransaction.inversePlan).apply()) {
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
