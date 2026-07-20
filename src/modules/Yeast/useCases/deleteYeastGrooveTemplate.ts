import { executeAppAction } from '#/modules/Command/useCases';

export async function deleteYeastGrooveTemplate(templateId: string): Promise<void> {
    await executeAppAction({
        type: 'deleteGrooveTemplate',
        payload: { templateId },
    });
}
