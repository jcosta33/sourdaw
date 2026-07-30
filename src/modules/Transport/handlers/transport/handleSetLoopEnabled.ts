import { createHandler } from '#/utils/createHandler';

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
        const previous = getTransportState()?.isLooping;
        return {
            label: action.payload.enabled ? 'Enable loop' : 'Disable loop',
            inverseAction: previous === undefined ? null : { type: 'setLoopEnabled', payload: { enabled: previous } },
        };
    },
    undoable: true,
});
