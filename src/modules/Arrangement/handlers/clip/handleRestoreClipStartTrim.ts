import { createHandler } from '#/utils/createHandler';

import { trimClipStart } from '../../useCases/clipEditing/trimClipStart';
import { writeTakeStarts } from '../../useCases/comping/writeTakeStarts';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

/**
 * Inverse of a start trim that moved loop-pass takes. The clip returns to its
 * earlier start through the trim itself, then each take returns to the start and
 * media offset it held, so one undo entry restores the clip and its takes
 * together. Redo replays the original trim, which plans the same take moves
 * against the restored state.
 */
export const handleRestoreClipStartTrim = createHandler<'restoreClipStartTrim'>({
    execute: (action) => {
        const { clipId, newStartBeat, takes } = action.payload;
        const restored = trimClipStart(clipId, newStartBeat);
        if (restored) {
            writeTakeStarts(takes);
        }
        return toHandlerExecutionResult(restored);
    },
    describe: () => ({ label: 'Restore clip start trim', inverseAction: null }),
    undoable: false,
});
