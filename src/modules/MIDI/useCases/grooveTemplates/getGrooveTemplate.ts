import { grooveTemplateStore } from '../../stores/grooveTemplateStore';

export function getGrooveTemplate(templateId: string) {
    return grooveTemplateStore.value?.templates.find((template) => template.id === templateId);
}
