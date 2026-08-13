import { logger } from '#/infra/logger/appLogger';
import { createHandler } from '#/utils/createHandler';

import { isEditingTool } from '../../models/EditingTool';
import { setEditingTool } from '../../useCases/setEditingTool';

export const handleSetEditingTool = createHandler<'setEditingTool'>({
    execute: (alpha) => {
        // The payload is typed `{ tool: string }` and the AI payload validator marks
        // this action 'unchecked', so the value arriving here is untrusted. The cast
        // this replaces wrote an arbitrary string into workspace state as the active
        // tool, where every consumer then treated it as an EditingTool.
        const { tool } = alpha.payload;
        if (!isEditingTool(tool)) {
            logger.warn(`[WorkspaceShell] Ignoring setEditingTool with unknown tool: ${String(tool)}`);
            return;
        }
        setEditingTool(tool);
    },
    describe: (alpha) => ({ label: `Set tool: ${alpha.payload.tool}` }),
    undoable: false,
});
