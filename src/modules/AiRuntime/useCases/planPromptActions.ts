import { captureProjectRevision } from '#/modules/CrdtDocument/useCases';

import { AiProposalInvalidatedError } from '../errors/AiProposalInvalidatedError';

import { getWholeProjectVibeMixScope } from './agentReference/getWholeProjectVibeMixScope';
import { getProjectContext } from './getProjectContext';
import { parsePromptToActions } from './parsePromptToActions';

type PlanPromptActionsInput = {
    prompt: string;
    signal?: AbortSignal;
};

export async function planPromptActions(input: PlanPromptActionsInput) {
    const projectRevision = captureProjectRevision();
    const context = getProjectContext();
    const result = await parsePromptToActions(input.prompt, context, input.signal, projectRevision);

    const wholeProjectVibeMixScope = getWholeProjectVibeMixScope(input.prompt, context, projectRevision);
    const wholeProjectVibeMixAction = result.actions.find((action) => action.type === 'automateTrackGainRange');
    if (wholeProjectVibeMixScope && wholeProjectVibeMixAction) {
        result.wholeProjectVibeMixPlan = {
            ...wholeProjectVibeMixScope.plan,
            commandBatch: [wholeProjectVibeMixAction],
        };
    }

    if (input.signal?.aborted !== true && result.actions.length > 0 && captureProjectRevision() !== projectRevision) {
        throw new AiProposalInvalidatedError();
    }

    return { context, result, projectRevision };
}
