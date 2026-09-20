import { resolveGrooveTemplateIdAlias } from '../../models/GrooveTemplate';
import { grooveTemplateStore, type GrooveTemplateState } from '../../stores/grooveTemplateStore';

export function getGrooveTemplate(templateId: string, state: GrooveTemplateState | null = grooveTemplateStore.value) {
    const resolvedId = resolveGrooveTemplateIdAlias(templateId);
    return state?.templates.find((template) => template.id === resolvedId);
}
