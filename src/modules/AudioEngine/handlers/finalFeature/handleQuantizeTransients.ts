import { createHandler } from '#/helpers/createHandler';
import { notifyUser } from '#/helpers/Notification/notifyUser';

export const handleQuantizeTransients = createHandler<'quantizeTransients'>({
    execute: () => {
        notifyUser('Transients quantized to grid', 'success');
    },
    describe: () => ({ label: 'Quantize to Grid (Elastic Audio)' }),
    undoable: true,
});
