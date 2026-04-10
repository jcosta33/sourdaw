import { createHandler } from '#/helpers/createHandler';
import { triggerScene } from '#/modules/Transport';

export const handleTriggerScene = createHandler<'triggerScene'>({
    execute: (a) => {
        triggerScene(a.payload.column);
    },
    describe: () => ({ label: 'Trigger Scene' }),
    undoable: false,
});
