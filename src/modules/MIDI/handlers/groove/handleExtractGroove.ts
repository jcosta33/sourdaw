import { createHandler } from '#/utils/createHandler';

import { createGrooveTemplate } from '../../useCases/grooveTemplates/createGrooveTemplate';
import { extractGrooveTemplate } from '../../useCases/grooveTemplates/extractGrooveTemplate';
import { getGrooveTemplate } from '../../useCases/grooveTemplates/getGrooveTemplate';
import { getNotesForClip } from '../../useCases/midiNoteCrud/getNotesForClip';

export const handleExtractGroove = createHandler<'extractGroove'>({
    execute: (action) => {
        const templateId = action.payload.templateId ?? `groove-${action.payload.clipId}-v1`;
        const result = extractGrooveTemplate({
            sourceId: action.payload.clipId,
            sourceName: action.payload.sourceName ?? action.payload.clipId,
            analyzerVersion: 1,
            subdivision: action.payload.subdivision ?? '1/16',
            templateId,
            notes: getNotesForClip(action.payload.clipId),
        });
        if (result.ok) {
            createGrooveTemplate(result.template);
        }
    },
    describe: (action) => {
        const templateId = action.payload.templateId ?? `groove-${action.payload.clipId}-v1`;
        return {
            label: 'Extract groove template',
            inverseAction: getGrooveTemplate(templateId)
                ? null
                : { type: 'deleteGrooveTemplate', payload: { templateId } },
        };
    },
    undoable: true,
});
