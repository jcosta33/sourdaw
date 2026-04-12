import { createHandler } from '#/utils/createHandler';
import { notifyUser } from '#/utils/Notification/notifyUser';

export const handleQuantizeTransients = createHandler<'quantizeTransients'>({
    execute: () => {
        notifyUser('Transients quantized to grid', 'success');
    },
    describe: () => ({ label: 'Quantize to Grid (Elastic Audio)' }),
    undoable: true,
});
