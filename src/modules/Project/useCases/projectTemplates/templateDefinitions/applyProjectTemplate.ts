import { templates } from './helpers';

export async function applyProjectTemplate(templateId: string): Promise<boolean> {
    const template = templates.find((candidate) => candidate.id === templateId);
    if (!template || template.executionBoundary !== 'app-action') {
        return false;
    }
    return template.create();
}
