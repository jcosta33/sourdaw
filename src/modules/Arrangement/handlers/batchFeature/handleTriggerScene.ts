import { triggerScene } from '#/modules/Transport/useCases';
import { createHandler } from '#/utils/createHandler';

export const handleTriggerScene = createHandler<'triggerScene'>({
    execute: (a) => {
        triggerScene(a.payload.column);
    },
    describe: () => ({ label: 'Trigger Scene' }),
    undoable: false,
});
