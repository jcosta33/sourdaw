import { createHandler } from '#/helpers/createHandler';
import { notifyUser } from '#/helpers/Notification/notifyUser';

export const handleDetectTransients = createHandler<'detectTransients'>({
    execute: () => {
        notifyUser('Transient detection requires an audio buffer — select an audio clip first');
    },
    describe: () => ({ label: 'Detect Transients' }),
    undoable: false,
});
