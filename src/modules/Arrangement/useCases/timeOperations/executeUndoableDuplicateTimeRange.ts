import { createUndoableGlobalTimeOperation } from './createUndoableGlobalTimeOperation';
import { duplicateTimeRange } from './duplicateTimeRange';

export function executeUndoableDuplicateTimeRange(startBeat: number, endBeat: number) {
    const initialResult = duplicateTimeRange(startBeat, endBeat);
    if (initialResult.status !== 'applied') {
        return null;
    }

    return createUndoableGlobalTimeOperation({ initialResult });
}
