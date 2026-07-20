import { executeAppAction } from '#/modules/Command/useCases';
import { type GrooveTemplateActionSnapshot } from '#/utils/handlerContract';

type CommitYeastGrooveExtractionInput = {
    clipId: string;
    sourceName: string;
    subdivision: string;
    templateId: string;
    proposal: GrooveTemplateActionSnapshot;
    sourceRevision: string;
};

export async function commitYeastGrooveExtraction({
    clipId,
    sourceName,
    subdivision,
    templateId,
    proposal,
    sourceRevision,
}: CommitYeastGrooveExtractionInput): Promise<void> {
    await executeAppAction({
        type: 'extractGroove',
        payload: {
            clipId,
            sourceName,
            subdivision,
            templateId,
            proposal,
            sourceRevision,
        },
    });
}
