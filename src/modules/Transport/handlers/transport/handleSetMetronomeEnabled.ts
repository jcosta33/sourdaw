import { createHandler } from '#/utils/createHandler';

import { setMetronomeEnabled } from '../../useCases/transportControls/setMetronomeEnabled';
import { getTransportState } from '../../useCases/transportQueries/getTransportState';

export const handleSetMetronomeEnabled = createHandler<'setMetronomeEnabled'>({
    execute: (action) => {
        setMetronomeEnabled(action.payload.enabled);
    },
    isNoop: (action) => getTransportState()?.metronomeEnabled === action.payload.enabled,
    describe: (action) => {
        const previous = getTransportState()?.metronomeEnabled;
        return {
            label: action.payload.enabled ? 'Enable metronome' : 'Disable metronome',
            inverseAction:
                previous === undefined ? null : { type: 'setMetronomeEnabled', payload: { enabled: previous } },
        };
    },
    undoable: true,
});
