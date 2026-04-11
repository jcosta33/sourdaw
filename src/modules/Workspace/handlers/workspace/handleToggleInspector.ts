import { createHandler } from '#/helpers/createHandler';
import { toggleInspector } from '../../useCases/togglePanel/panelToggles/toggleInspector';

export const handleToggleInspector = createHandler<'toggleInspector'>({
    execute: () => {
        toggleInspector();
    },
    describe: () => ({ label: 'Toggle inspector' }),
    undoable: false,
});
