import { createHandler } from '#/utils/createHandler';

import { setPunchEnabled } from '../../useCases/transportControls/setPunchEnabled';
import { getTransportState } from '../../useCases/transportQueries/getTransportState';

export const handleSetPunchEnabled = createHandler<'setPunchEnabled'>({
    execute: (action) => setPunchEnabled(action.payload),
    isNoop: (action) => getTransportState()?.punchInEnabled === action.payload.enabled,
    describe: (action) => {
        const previous = getTransportState()?.punchInEnabled;
        const label = action.payload.enabled ? 'Enable Punch In/Out' : 'Disable Punch In/Out';
        if (previous === undefined) {
            return { label, inverseAction: null };
        }
        return {
            label,
            inverseAction: {
                type: 'setPunchEnabled',
                payload: { enabled: previous, expectedEnabled: action.payload.enabled },
            },
            redoAction: {
                type: 'setPunchEnabled',
                payload: { enabled: action.payload.enabled, expectedEnabled: previous },
            },
        };
    },
    undoable: true,
});
