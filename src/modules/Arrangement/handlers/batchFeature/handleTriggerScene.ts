import { createHandler } from '#/helpers/createHandler';
import { triggerScene } from '#/modules/Transport/useCases';

export const handleTriggerScene = createHandler<'triggerScene'>({
    execute: (a) => {
        triggerScene(a.payload.column);
    },
    describe: () => ({ label: 'Trigger Scene' }),
    undoable: false,
});
