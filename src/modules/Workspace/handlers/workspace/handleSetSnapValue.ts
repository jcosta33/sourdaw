import { createHandler } from '#/utils/createHandler';
import { setSnapValue } from '../../useCases/togglePanel/panelToggles/setSnapValue';

export const handleSetSnapValue = createHandler<'setSnapValue'>({
    execute: (a) => {
        setSnapValue(a.payload.value);
    },
    describe: (a) => ({ label: `Set snap to ${a.payload.value}` }),
    undoable: false,
});
