import { STRAIGHT_GROOVE_TEMPLATE_ID, type GrooveTemplate } from '../../models/GrooveTemplate';
import { grooveTemplateStore } from '../../stores/grooveTemplateStore';

import { resolveGrooveTemplateName } from './resolveGrooveTemplateName';

type RenameGrooveTemplateInput = {
    templateId: string;
    name: string;
};

export function renameGrooveTemplate({ templateId, name }: RenameGrooveTemplateInput): GrooveTemplate | null {
    const state = grooveTemplateStore.value;
    const current = state?.templates.find((template) => template.id === templateId);
    if (!state || !current || templateId === STRAIGHT_GROOVE_TEMPLATE_ID) {
        return current ?? null;
    }
    const renamed = {
        ...current,
        name: resolveGrooveTemplateName({
            requestedName: name,
            templates: state.templates,
            ignoreTemplateId: templateId,
        }),
    };
    grooveTemplateStore.set({
        ...state,
        templates: state.templates.map((template) => (template.id === templateId ? renamed : template)),
    });
    return renamed;
}
