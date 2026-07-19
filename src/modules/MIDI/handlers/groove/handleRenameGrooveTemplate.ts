import { createHandler } from '#/utils/createHandler';

import { renameGrooveTemplate } from '../../useCases/grooveTemplates/renameGrooveTemplate';
import { resolveGrooveTemplateRename } from '../../useCases/grooveTemplates/resolveGrooveTemplateRename';

export const handleRenameGrooveTemplate = createHandler<'renameGrooveTemplate'>({
    isNoop: (action) => {
        const resolved = resolveGrooveTemplateRename(action.payload);
        return !resolved || resolved.current.name === resolved.nextName;
    },
    execute: (action) => {
        renameGrooveTemplate(action.payload);
    },
    describe: (action) => {
        const resolved = resolveGrooveTemplateRename(action.payload);
        return {
            label: `Rename groove template to "${action.payload.name}"`,
            inverseAction: resolved
                ? {
                      type: 'restoreGrooveTemplateName',
                      payload: {
                          templateId: resolved.current.id,
                          name: resolved.current.name,
                          expectedName: resolved.nextName,
                      },
                  }
                : null,
        };
    },
    undoable: true,
});
