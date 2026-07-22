import { templates } from './helpers';

export async function applyProjectTemplate(templateId: string): Promise<boolean> {
    const template = templates.find((candidate) => candidate.id === templateId);
    if (!template) {
        return false;
    }
    return template.create();
}
