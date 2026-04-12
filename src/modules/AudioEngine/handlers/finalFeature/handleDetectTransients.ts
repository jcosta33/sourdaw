import { createHandler } from '#/utils/createHandler';
import { notifyUser } from '#/utils/Notification/notifyUser';

export const handleDetectTransients = createHandler<'detectTransients'>({
    execute: () => {
        notifyUser('Transient detection requires an audio buffer — select an audio clip first');
    },
    describe: () => ({ label: 'Detect Transients' }),
    undoable: false,
});
