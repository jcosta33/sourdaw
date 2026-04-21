import { triggerScene } from '#/modules/Transport/useCases';
import { createHandler } from '#/utils/createHandler';

export const handleTriggerScene = createHandler<'triggerScene'>({
    execute: (alpha) => {
        triggerScene(alpha.payload.column);
    },
    describe: () => ({ label: 'Trigger Scene' }),
    undoable: false,
});
