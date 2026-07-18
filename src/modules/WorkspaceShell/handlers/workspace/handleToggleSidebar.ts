import { createHandler } from '#/utils/createHandler';

import { toggleSidebar } from '../../useCases/togglePanel/panelToggles/toggleSidebar';

export const handleToggleSidebar = createHandler<'toggleSidebar'>({
    execute: () => {
        toggleSidebar();
    },
    describe: () => ({ label: 'Toggle sidebar' }),
    undoable: false,
});
