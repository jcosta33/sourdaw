import { createHandler } from '#/utils/createHandler';

import { resolveLoopEnableRegion } from '../../useCases/transportControls/resolveLoopEnableRegion';
import { setLoopEnabled } from '../../useCases/transportControls/setLoopEnabled';
import { getTransportState } from '../../useCases/transportQueries/getTransportState';

export const handleSetLoopEnabled = createHandler<'setLoopEnabled'>({
    execute: (action) => {
        const applied = setLoopEnabled(action.payload.enabled);
        if (!applied) {
            return { status: 'no-write' };
        }
        return { status: 'written' };
    },
    isNoop: (action) => getTransportState()?.isLooping === action.payload.enabled,
    describe: (action) => {
        const previous = getTransportState();
        const label = action.payload.enabled ? 'Enable loop' : 'Disable loop';
        if (!previous) {
            return { label, inverseAction: null };
        }
        const region = action.payload.enabled ? resolveLoopEnableRegion(previous) : null;
        if (!region) {
            return {
                label,
                inverseAction: { type: 'setLoopEnabled', payload: { enabled: previous.isLooping } },
            };
        }
        const before = { loopStart: previous.loopStart, loopEnd: previous.loopEnd, isLooping: previous.isLooping };
        const after = { ...region, isLooping: true };
        return {
            label,
            inverseAction: { type: 'restoreLoopRegion', payload: { expected: after, replacement: before } },
            redoAction: { type: 'restoreLoopRegion', payload: { expected: before, replacement: after } },
        };
    },
    undoable: true,
});
