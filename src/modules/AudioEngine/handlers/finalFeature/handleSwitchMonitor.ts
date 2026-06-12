import { createHandler } from '#/utils/createHandler';

import { switchMonitor } from '../../useCases/controlRoom/switchMonitor';

export const handleSwitchMonitor = createHandler<'switchMonitor'>({
    execute: (action) => {
        switchMonitor(action.payload.monitorId);
    },
    describe: () => ({ label: 'Switch Monitor Output' }),
    undoable: false,
});
