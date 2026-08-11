import { createUndoableGlobalTimeOperation } from './createUndoableGlobalTimeOperation';
import { insertTime } from './insertTime';

export function executeUndoableInsertTime(atBeat: number, durationBeats: number) {
    const initialResult = insertTime(atBeat, durationBeats);
    if (initialResult.status !== 'applied') {
        return null;
    }

    return createUndoableGlobalTimeOperation({ initialResult });
}
