import { createHandler } from '#/utils/createHandler';

import { markGrooveTemplateProjectWrite } from '../../useCases/grooveTemplates/markGrooveTemplateProjectWrite';
import { renameGrooveTemplate } from '../../useCases/grooveTemplates/renameGrooveTemplate';
import { resolveGrooveTemplateRename } from '../../useCases/grooveTemplates/resolveGrooveTemplateRename';

export const handleRenameGrooveTemplate = createHandler<'renameGrooveTemplate'>({
    isNoop: (action) => {
        const resolved = resolveGrooveTemplateRename(action.payload);
        return !resolved || resolved.current.name === resolved.nextName;
    },
    execute: (action) => {
        const resolved = resolveGrooveTemplateRename(action.payload);
        if (!resolved || resolved.current.name === resolved.nextName) {
            return { status: 'no-write' };
        }
        renameGrooveTemplate(action.payload);
        return {
            status: 'written',
            afterCommit: markGrooveTemplateProjectWrite,
            afterAmbiguousCommit: markGrooveTemplateProjectWrite,
        };
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
