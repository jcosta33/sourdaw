import { createHandler } from '#/helpers/createHandler';
import { toggleNodeView } from '#/modules/Plugin';

export const handleToggleNodeView = createHandler<'toggleNodeView'>({
    execute: () => {
        toggleNodeView();
    },
    describe: () => ({ label: 'Toggle Node-Based View' }),
    undoable: false,
});
