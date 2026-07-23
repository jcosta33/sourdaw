import { pushUndoEntry, REDO_NOT_APPLIED } from '#/modules/Command/useCases';

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
        }
    );
}
