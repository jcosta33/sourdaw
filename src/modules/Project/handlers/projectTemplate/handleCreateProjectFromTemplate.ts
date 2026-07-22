import { createHandler } from '#/utils/createHandler';

import { applyProjectTemplate } from '../../useCases/projectTemplates/templateDefinitions/applyProjectTemplate';

export const handleCreateProjectFromTemplate = createHandler<'createProjectFromTemplate'>({
    execute: async (action) => {
        const created = await applyProjectTemplate(action.payload.templateId);
        return created ? { status: 'written' } : { status: 'no-write' };
    },
    describe: () => ({ label: 'Create project from template' }),
    undoable: false,
});
