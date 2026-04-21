import { switchMonitor } from '#/modules/AudioEngine/useCases';
import { createHandler } from '#/utils/createHandler';

export const handleSwitchMonitor = createHandler<'switchMonitor'>({
    execute: (alpha) => {
        switchMonitor(alpha.payload.monitorId);
    },
    describe: () => ({ label: 'Switch Monitor Output' }),
    undoable: false,
});
