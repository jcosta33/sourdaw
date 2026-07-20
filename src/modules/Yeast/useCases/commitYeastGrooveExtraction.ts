import { executeAppAction } from '#/modules/Command/useCases';
import { getGrooveExtractionActionErrorCode } from '#/modules/MIDI/useCases';
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
}: CommitYeastGrooveExtractionInput) {
    try {
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
        return { status: 'committed' as const };
    } catch (error) {
        const reason = getGrooveExtractionActionErrorCode(error);
        if (!reason) {
            throw error;
        }
        return { status: 'rejected' as const, reason };
    }
}
