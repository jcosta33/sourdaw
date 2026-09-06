import { executeUserAppAction } from '#/modules/Command/useCases';

export async function deleteYeastGrooveTemplate(templateId: string): Promise<void> {
    await executeUserAppAction({
        type: 'deleteGrooveTemplate',
        payload: { templateId },
    });
}
