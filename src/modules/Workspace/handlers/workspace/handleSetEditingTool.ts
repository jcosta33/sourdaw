import { createHandler } from '#/utils/createHandler';

import { setEditingTool } from '../../useCases/setEditingTool';
import { type EditingTool } from '../../useCases/workspaceQueries/helpers';

export const handleSetEditingTool = createHandler<'setEditingTool'>({
    execute: (alpha) => {
        setEditingTool(alpha.payload.tool as EditingTool);
    },
    describe: (alpha) => ({ label: `Set tool: ${alpha.payload.tool}` }),
    undoable: false,
});
