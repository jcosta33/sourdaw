import { createHandler } from '#/utils/createHandler';
import { toggleNodeView } from '#/modules/Plugin/useCases';

export const handleToggleNodeView = createHandler<'toggleNodeView'>({
    execute: () => {
        toggleNodeView();
    },
    describe: () => ({ label: 'Toggle Node-Based View' }),
    undoable: false,
});
