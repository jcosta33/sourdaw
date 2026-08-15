import { captureProjectRevision } from '#/modules/CrdtDocument/useCases';

import { AiProposalInvalidatedError } from '../errors/AiProposalInvalidatedError';
import { type ModelProviderResult, type ModelProviderStreamIdentity } from '../models/ModelProviderProtocol';
import { type StemImportPromptScope } from '../models/StemImportCapability';

import { createStemImportPromptScope } from './agentReference/createStemImportPromptScope';
import { discardPreparedStemImportResources } from './agentReference/discardPreparedStemImportResources';
import { getWholeProjectVibeMixScope } from './agentReference/getWholeProjectVibeMixScope';
import { prepareStemImport } from './agentReference/prepareStemImport';
import { preparedStemImportResources } from './agentReference/registerPreparedStemImportResources';
import { getProjectContext } from './getProjectContext';
import { parsePromptToActions } from './parsePromptToActions';

type PlanPromptActionsInput = {
    prompt: string;
    signal?: AbortSignal;
    onProviderResult?: (result: ModelProviderResult) => void;
    streamIdentity?: Pick<ModelProviderStreamIdentity, 'runId' | 'requestId' | 'cancellationGeneration'>;
};

export async function planPromptActions(input: PlanPromptActionsInput) {
    const projectRevision = captureProjectRevision();
    const context = getProjectContext();
    let stemImportScope: StemImportPromptScope | undefined;
    let result;
    try {
        result = await parsePromptToActions(
            input.prompt,
            context,
            input.signal,
            projectRevision,
            undefined,
            input.onProviderResult,
            input.streamIdentity
        );
        if (result.preparationRequest === 'stem-import') {
            const preparedStemImport = await prepareStemImport(input.signal);
            if (preparedStemImport.status === 'cancelled') {
                return {
                    context,
                    result: { actions: [], rawText: input.prompt, requiresConfirmation: false },
                    projectRevision,
                };
            }
            stemImportScope = createStemImportPromptScope(preparedStemImport, projectRevision);
            if (input.streamIdentity !== undefined) {
                preparedStemImportResources.register({
                    runId: input.streamIdentity.runId,
                    stems: stemImportScope.actionSeed.stems,
                });
            }
            result = await parsePromptToActions(
                input.prompt,
                context,
                input.signal,
                projectRevision,
                stemImportScope,
                input.onProviderResult,
                input.streamIdentity
            );
        }
    } catch (error) {
        if (stemImportScope) {
            discardPreparedStemImportResources(stemImportScope.actionSeed.stems);
        }
        throw error;
    }
    if (stemImportScope && !result.actions.some((action) => action.type === 'importStemSet')) {
        discardPreparedStemImportResources(stemImportScope.actionSeed.stems);
    }

    const wholeProjectVibeMixScope = getWholeProjectVibeMixScope(input.prompt, context, projectRevision);
    const wholeProjectVibeMixAction = result.actions.find((action) => action.type === 'automateTrackGainRange');
    if (wholeProjectVibeMixScope && wholeProjectVibeMixAction) {
        result.wholeProjectVibeMixPlan = {
            ...wholeProjectVibeMixScope.plan,
            commandBatch: [wholeProjectVibeMixAction],
        };
    }

    if (input.signal?.aborted !== true && result.actions.length > 0 && captureProjectRevision() !== projectRevision) {
        if (stemImportScope) {
            discardPreparedStemImportResources(stemImportScope.actionSeed.stems);
        }
        throw new AiProposalInvalidatedError();
    }

    return { context, result, projectRevision };
}
