import { createHandler } from '#/utils/createHandler';

import { triggerScene } from '../../useCases/loopStation/triggerScene';

export const handleTriggerScene = createHandler<'triggerScene'>({
    execute: (action) => {
        triggerScene(action.payload.column);
    },
    describe: () => ({ label: 'Trigger Scene' }),
    undoable: false,
});
