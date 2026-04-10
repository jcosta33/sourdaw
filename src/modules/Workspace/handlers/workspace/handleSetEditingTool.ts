import { createHandler } from '#/helpers/createHandler';
import { setEditingTool } from '../../useCases/setEditingTool';
import { type EditingTool } from '../../useCases/workspaceQueries';

export const handleSetEditingTool = createHandler<'setEditingTool'>({
    execute: (a) => {
        setEditingTool(a.payload.tool as EditingTool);
    },
    describe: (a) => ({ label: `Set tool: ${a.payload.tool}` }),
    undoable: false,
});
