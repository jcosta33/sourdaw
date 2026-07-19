import { STRAIGHT_GROOVE_TEMPLATE_ID, type GrooveTemplate } from '../../models/GrooveTemplate';
import { grooveTemplateStore } from '../../stores/grooveTemplateStore';

import { resolveGrooveTemplateName } from './resolveGrooveTemplateName';

type ResolveGrooveTemplateRenameInput = {
    templateId: string;
    name: string;
};

type ResolveGrooveTemplateRenameResult = {
    current: GrooveTemplate;
    nextName: string;
};

export function resolveGrooveTemplateRename({
    templateId,
    name,
}: ResolveGrooveTemplateRenameInput): ResolveGrooveTemplateRenameResult | null {
    const state = grooveTemplateStore.value;
    const current = state?.templates.find((template) => template.id === templateId);
    if (!state || !current || templateId === STRAIGHT_GROOVE_TEMPLATE_ID || current.provenance.type === 'builtin') {
        return null;
    }
    return {
        current,
        nextName: resolveGrooveTemplateName({
            requestedName: name,
            templates: state.templates,
            ignoreTemplateId: templateId,
        }),
    };
}
