import { createHandler } from '#/utils/createHandler';

import { resolveNextLoopRegion } from '../../useCases/transportControls/resolveNextLoopRegion';
import { toggleLoop } from '../../useCases/transportControls/toggleLoop';
import { getTransportState } from '../../useCases/transportQueries/getTransportState';

function restoreLoopRegionAction(
    expected: { loopStart: number; loopEnd: number; isLooping: boolean },
    replacement: {
        loopStart: number;
        loopEnd: number;
        isLooping: boolean;
    }
) {
    return { type: 'restoreLoopRegion' as const, payload: { expected, replacement } };
}

export const handleToggleLoop = createHandler<'toggleLoop'>({
    execute: () => ({ status: toggleLoop() ? 'written' : 'no-write' }),
    describe: () => {
        const state = getTransportState();
        const after = resolveNextLoopRegion(state);
        if (!state || !after) {
            return { label: 'Toggle loop', inverseAction: null };
        }

        const before = { loopStart: state.loopStart, loopEnd: state.loopEnd, isLooping: state.isLooping };
        return {
            label: 'Toggle loop',
            inverseAction: restoreLoopRegionAction(after, before),
            redoAction: restoreLoopRegionAction(before, after),
        };
    },
    undoable: true,
});
