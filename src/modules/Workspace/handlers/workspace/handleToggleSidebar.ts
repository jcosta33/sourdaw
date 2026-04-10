import { createHandler } from '#/helpers/createHandler';
import { toggleSidebar } from '../../useCases/togglePanel/panelToggles';

export const handleToggleSidebar = createHandler<'toggleSidebar'>({
    execute: () => {
        toggleSidebar();
    },
    describe: () => ({ label: 'Toggle sidebar' }),
    undoable: false,
});
