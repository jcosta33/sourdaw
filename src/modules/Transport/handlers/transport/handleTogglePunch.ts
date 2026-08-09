import { createHandler } from '#/utils/createHandler';

import { togglePunchEnabled } from '../../useCases/transportControls/togglePunchEnabled';
import { getTransportState } from '../../useCases/transportQueries/getTransportState';

export const handleTogglePunch = createHandler<'togglePunch'>({
    execute: () => togglePunchEnabled(),
    isNoop: () => getTransportState() === null,
    describe: () => {
        const previous = getTransportState()?.punchInEnabled;
        if (previous === undefined) {
            return { label: 'Toggle punch recording', inverseAction: null };
        }
        const next = !previous;
        return {
            label: next ? 'Enable punch recording' : 'Disable punch recording',
            inverseAction: {
                type: 'setPunchEnabled',
                payload: { enabled: previous, expectedEnabled: next },
            },
            redoAction: {
                type: 'setPunchEnabled',
                payload: { enabled: next, expectedEnabled: previous },
            },
        };
    },
    undoable: true,
});
