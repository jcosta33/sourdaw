import { captureProjectRevision } from '#/modules/CrdtDocument/useCases';

import { AiProposalInvalidatedError } from '../errors/AiProposalInvalidatedError';
import { type ModelProviderResult, type ModelProviderStreamIdentity } from '../models/ModelProviderProtocol';
import { type StemImportPromptScope } from '../models/StemImportCapability';

import { normalizeAgentFailure } from './agentErrorAndSaga';
import { createStemImportPromptScope } from './agentReference/createStemImportPromptScope';
import { discardPreparedStemImportResources } from './agentReference/discardPreparedStemImportResources';
import { getWholeProjectVibeMixScope } from './agentReference/getWholeProjectVibeMixScope';
import { prepareStemImport } from './agentReference/prepareStemImport';
import { preparedStemImportResources } from './agentReference/registerPreparedStemImportResources';
import { agentRunLifecycle } from './agentRunLifecycle';
import { agentRunCancellation } from './cancelAgentRun';
import { getProjectContext } from './getProjectContext';
import { type ProviderAttemptAdmission, type ProviderAttemptAdmissionResult } from './llmOrchestration/inference';
import { parsePromptToActions } from './parsePromptToActions';

type PlanPromptActionsInput = {
    prompt: string;
    signal?: AbortSignal;
    onProviderResult?: (result: ModelProviderResult) => void;
    streamIdentity?: Pick<ModelProviderStreamIdentity, 'runId' | 'requestId' | 'cancellationGeneration'>;
    onProviderAttempt?: (input: ProviderAttemptAdmission) => ProviderAttemptAdmissionResult;
    onLocalWorkAttempt?: (input: { analysisCount: number; downloadBytes: number; storageBytes: number }) => boolean;
};

export async function planPromptActions(input: PlanPromptActionsInput) {
    const projectRevision = captureProjectRevision();
    const context = getProjectContext();
    const streamIdentity = (() => {
        if (input.streamIdentity !== undefined) {
            if (agentRunLifecycle.get(input.streamIdentity.runId) === null) {
                throw new Error('Executable provider planning requires an admitted agent run.');
            }
            return input.streamIdentity;
        }
        const runId = `agent-run-${crypto.randomUUID()}`;
        agentRunLifecycle.create({
            runId,
            request: input.prompt,
            mode: 'plan',
            createdRevision: projectRevision,
        });
        return { runId, requestId: `planning:${runId}`, cancellationGeneration: 0 };
    })();
    const autoCreatedRun = input.streamIdentity === undefined;
    let autoRunCancellation: Promise<unknown> | undefined;
    const cancelAutoCreatedRun = () => {
        if (!autoCreatedRun) {
            return Promise.resolve();
        }
        autoRunCancellation ??= agentRunCancellation.cancel({
            runId: streamIdentity.runId,
            reason: 'Planning cancelled by the originating request.',
        });
        return autoRunCancellation;
    };
    const settleAutoCreatedRun = async (outcome: 'completed' | 'failed') => {
        if (!autoCreatedRun) {
            return;
        }
        if (input.signal?.aborted) {
            await cancelAutoCreatedRun();
            return;
        }
        const run = agentRunLifecycle.get(streamIdentity.runId);
        if (!run || ['completed', 'failed', 'cancelled', 'partially-completed'].includes(run.phase)) {
            return;
        }
        if (run.phase === 'created') {
            agentRunLifecycle.transitionPhase({ runId: run.runId, phase: 'planning' });
        }
        agentRunLifecycle.transitionPhase({ runId: run.runId, phase: outcome });
    };
    const onAbort = () => {
        void cancelAutoCreatedRun();
    };
    input.signal?.addEventListener('abort', onAbort, { once: true });
    if (input.signal?.aborted) {
        await cancelAutoCreatedRun();
    }
    const onProviderAttempt =
        input.onProviderAttempt ??
        (() => ({
            status: 'rejected' as const,
            reason: 'Provider planning requires an application-owned budget admission.',
        }));
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
            streamIdentity,
            onProviderAttempt
        );
        if (result.preparationRequest === 'stem-import') {
            const preparedStemImport = await prepareStemImport(input.signal, input.onLocalWorkAttempt);
            if (preparedStemImport.status === 'cancelled') {
                await settleAutoCreatedRun('completed');
                input.signal?.removeEventListener('abort', onAbort);
                return {
                    context,
                    result: { actions: [], rawText: input.prompt, requiresConfirmation: false },
                    projectRevision,
                };
            }
            stemImportScope = createStemImportPromptScope(preparedStemImport, projectRevision);
            if (streamIdentity !== undefined) {
                preparedStemImportResources.register({
                    runId: streamIdentity.runId,
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
                streamIdentity,
                onProviderAttempt
            );
        }
    } catch (error) {
        if (stemImportScope) {
            discardPreparedStemImportResources(stemImportScope.actionSeed.stems);
        }
        let category: 'conflict' | 'cancellation' | 'provider' = 'provider';
        if (error instanceof AiProposalInvalidatedError) {
            category = 'conflict';
        } else if (input.signal?.aborted) {
            category = 'cancellation';
        }
        agentRunLifecycle.recordError({
            runId: streamIdentity.runId,
            error: normalizeAgentFailure({
                category,
                source: 'provider-planning',
                related: { workIds: [streamIdentity.requestId] },
                retry: category === 'provider' ? 'read-only' : 'never',
                knownDomain: category !== 'provider',
            }),
            terminal: true,
        });
        await settleAutoCreatedRun('failed');
        input.signal?.removeEventListener('abort', onAbort);
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
        await settleAutoCreatedRun('failed');
        input.signal?.removeEventListener('abort', onAbort);
        throw new AiProposalInvalidatedError();
    }

    await settleAutoCreatedRun(result.rejectionReason ? 'failed' : 'completed');
    input.signal?.removeEventListener('abort', onAbort);

    return { context, result, projectRevision };
}
