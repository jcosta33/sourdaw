import { createHandler } from '#/utils/createHandler';

import { canonicalizeGrooveTemplateId } from '../../models/GrooveTemplate';
import { createGrooveTemplate } from '../../useCases/grooveTemplates/createGrooveTemplate';
import { getGrooveTemplate } from '../../useCases/grooveTemplates/getGrooveTemplate';

export const handleCreateGrooveTemplate = createHandler<'createGrooveTemplate'>({
    execute: (action) => {
        const id = canonicalizeGrooveTemplateId(action.payload.id);
        if (!id) {
            throw new Error('Groove template ID must be nonempty');
        }
        createGrooveTemplate({ ...action.payload, id });
    },
    describe: (action) => {
        const id = canonicalizeGrooveTemplateId(action.payload.id);
        if (!id) {
            throw new Error('Groove template ID must be nonempty');
        }
        return {
            label: `Create groove template "${action.payload.name}"`,
            inverseAction: getGrooveTemplate(id) ? null : { type: 'deleteGrooveTemplate', payload: { templateId: id } },
        };
    },
    undoable: true,
});
