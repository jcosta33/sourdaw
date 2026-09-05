import { executeUserAppAction } from '#/modules/Command/useCases';

export async function renameYeastGrooveTemplate(templateId: string, name: string): Promise<void> {
    await executeUserAppAction({
        type: 'renameGrooveTemplate',
        payload: { templateId, name },
    });
}
