import { createUndoableGlobalTimeOperation } from './createUndoableGlobalTimeOperation';
import { insertTime } from './insertTime';

export function executeUndoableInsertTime(atBeat: number, durationBeats: number) {
    const initialResult = insertTime(atBeat, durationBeats);
    if (initialResult.status !== 'applied') {
        return null;
    }

    const replayPlan = initialResult.replayPlan;
    return createUndoableGlobalTimeOperation({
        initialResult,
        replay: () => insertTime(atBeat, durationBeats, replayPlan),
    });
}
