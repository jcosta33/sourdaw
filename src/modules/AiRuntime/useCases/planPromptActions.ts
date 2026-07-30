import { captureProjectRevision } from '#/modules/CrdtDocument/useCases';

import { AiProposalInvalidatedError } from '../errors/AiProposalInvalidatedError';

import { getProjectContext } from './getProjectContext';
import { parsePromptToActions } from './parsePromptToActions';

type PlanPromptActionsInput = {
    prompt: string;
    signal?: AbortSignal;
};

export async function planPromptActions(input: PlanPromptActionsInput) {
    const projectRevision = captureProjectRevision();
    const context = getProjectContext();
    const result = await parsePromptToActions(input.prompt, context, input.signal);

    if (input.signal?.aborted !== true && result.actions.length > 0 && captureProjectRevision() !== projectRevision) {
        throw new AiProposalInvalidatedError();
    }

    return { context, result, projectRevision };
}
