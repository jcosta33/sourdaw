import { toggleNodeView } from '#/modules/Plugin/useCases';
import { createHandler } from '#/utils/createHandler';

export const handleToggleNodeView = createHandler<'toggleNodeView'>({
    execute: () => {
        toggleNodeView();
    },
    describe: () => ({ label: 'Toggle Node-Based View' }),
    undoable: false,
});
