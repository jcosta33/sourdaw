import { executeAppAction } from '#/modules/Command/useCases';

type CommitYeastGrooveExtractionInput = {
    clipId: string;
    sourceName: string;
    subdivision: string;
    templateId: string;
};

export async function commitYeastGrooveExtraction({
    clipId,
    sourceName,
    subdivision,
    templateId,
}: CommitYeastGrooveExtractionInput): Promise<void> {
    await executeAppAction({
        type: 'extractGroove',
        payload: {
            clipId,
            sourceName,
            subdivision,
            templateId,
        },
    });
}
