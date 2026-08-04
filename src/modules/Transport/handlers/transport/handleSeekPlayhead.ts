import { createHandler } from '#/utils/createHandler';

import { transportStore } from '../../stores/transportStore';
import { executePlayheadSeek } from '../../useCases/transportControls/executePlayheadSeek';

export const handleSeekPlayhead = createHandler<'seekPlayhead'>({
    execute: (action) => {
        const completion = executePlayheadSeek(action.payload.beat);
        return {
            status: 'written',
            afterRuntimeExecution: () => completion,
        };
    },
    describe: (action) => ({ label: `Seek to beat ${action.payload.beat}` }),
    executionKind: 'runtime',
    isNoop: (action) => {
        const state = transportStore.value;
        return state === null || state.playheadPosition === action.payload.beat;
    },
    undoable: false,
});
