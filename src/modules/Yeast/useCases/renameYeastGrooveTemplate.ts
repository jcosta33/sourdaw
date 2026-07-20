import { executeAppAction } from '#/modules/Command/useCases';

export async function renameYeastGrooveTemplate(templateId: string, name: string): Promise<void> {
    await executeAppAction({
        type: 'renameGrooveTemplate',
        payload: { templateId, name },
    });
}
