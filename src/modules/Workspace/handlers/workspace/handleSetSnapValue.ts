import { createHandler } from '#/utils/createHandler';

import { setSnapValue } from '../../useCases/togglePanel/panelToggles/setSnapValue';

export const handleSetSnapValue = createHandler<'setSnapValue'>({
    execute: (alpha) => {
        setSnapValue(alpha.payload.value);
    },
    describe: (alpha) => ({ label: `Set snap to ${alpha.payload.value}` }),
    undoable: false,
});
