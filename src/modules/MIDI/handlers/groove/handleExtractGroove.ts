import { createHandler } from '#/utils/createHandler';
import { type AppAction } from '#/utils/handlerContract';

import { STRAIGHT_GROOVE_TEMPLATE_ID } from '../../models/GrooveTemplate';
import { createGrooveTemplate } from '../../useCases/grooveTemplates/createGrooveTemplate';
import { extractGrooveTemplate } from '../../useCases/grooveTemplates/extractGrooveTemplate';
import { getGrooveTemplate } from '../../useCases/grooveTemplates/getGrooveTemplate';
import { getNotesForClip } from '../../useCases/midiNoteCrud/getNotesForClip';

type ExtractGrooveAction = Extract<AppAction, { type: 'extractGroove' }>;

function planExtractGroove(action: ExtractGrooveAction) {
    const result = extractGrooveTemplate({
        sourceId: action.payload.clipId,
        sourceName: action.payload.sourceName ?? action.payload.clipId,
        analyzerVersion: 1,
        subdivision: action.payload.subdivision ?? '1/16',
        templateId: action.payload.templateId ?? `groove-${action.payload.clipId}-v1`,
        notes: getNotesForClip(action.payload.clipId),
    });
    const template = result.ok ? result.template : null;
    const createsTemplate =
        template !== null &&
        template.id !== STRAIGHT_GROOVE_TEMPLATE_ID &&
        getGrooveTemplate(template.id) === undefined;
    return { createsTemplate, template };
}

export const handleExtractGroove = createHandler<'extractGroove'>({
    execute: (action) => {
        const plan = planExtractGroove(action);
        if (plan.createsTemplate && plan.template) {
            createGrooveTemplate(plan.template);
        }
    },
    describe: (action) => {
        const plan = planExtractGroove(action);
        return {
            label: 'Extract groove template',
            inverseAction:
                plan.createsTemplate && plan.template
                    ? { type: 'deleteGrooveTemplate', payload: { templateId: plan.template.id } }
                    : null,
        };
    },
    undoable: true,
});
