import { createHandler } from '#/helpers/createHandler';
import { switchMonitor } from '#/modules/AudioEngine';

export const handleSwitchMonitor = createHandler<'switchMonitor'>({
    execute: (a) => {
        switchMonitor(a.payload.monitorId);
    },
    describe: () => ({ label: 'Switch Monitor Output' }),
    undoable: false,
});
