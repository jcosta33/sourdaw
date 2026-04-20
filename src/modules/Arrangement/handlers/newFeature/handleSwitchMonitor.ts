import { switchMonitor } from '#/modules/AudioEngine/useCases';
import { createHandler } from '#/utils/createHandler';

export const handleSwitchMonitor = createHandler<'switchMonitor'>({
    execute: (a) => {
        switchMonitor(a.payload.monitorId);
    },
    describe: () => ({ label: 'Switch Monitor Output' }),
    undoable: false,
});
