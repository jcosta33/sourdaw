import { resolveGrooveTemplateIdAlias } from '../../models/GrooveTemplate';
import { grooveTemplateStore } from '../../stores/grooveTemplateStore';

export function getGrooveTemplate(templateId: string) {
    const resolvedId = resolveGrooveTemplateIdAlias(templateId);
    return grooveTemplateStore.value?.templates.find((template) => template.id === resolvedId);
}
