import { logger } from '#/infra/logger/appLogger';
import { captureProjectRevision, projectRevisionMatchesLiveIgnoringSaveWrites } from '#/modules/CrdtDocument/useCases';
import { canonicalJson } from '#/utils/canonicalDigest';

import { type ToolCallResult } from '../../models/ToolCallResult';
import { admitBoundedAgentCorrection } from '../admitBoundedAgentCorrection';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { agentRunWorkLease } from '../agentRunWorkLease';
import { agentRunCancellation } from '../cancelAgentRun';
import { generateToolPlanningOutcome } from '../llmOrchestration/inference';
import { recordAgentProviderUsage } from '../recordAgentProviderUsage';

import { buildVibeBatchCorrectionMessage } from './buildVibeBatchCorrectionMessage';
import { type VibeBatchValueRequest } from './buildVibeBatchValueRequest';
import { isHostedValueChoiceChain } from './isHostedValueChoiceChain';
import { type VibeBatchPairValues, readVibeBatchValueReply } from './readVibeBatchValueReply';

/** Why a batch expands at its catalogue defaults rather than at values the provider chose. */
export type VibeBatchDefaultsReason = 'local-backend' | 'declined' | 'failed' | 'correction-exhausted' | 'budget';

export type VibeBatchValueChoice =
    | { readonly source: 'measurements'; readonly pairs: readonly VibeBatchPairValues[] }
    | { readonly source: 'catalogue-defaults'; readonly reason: VibeBatchDefaultsReason; readonly detail: string };

export type VibeBatchValueChoiceOutcome = VibeBatchValueChoice | { readonly source: 'stopped' };

/** One correction after a refused reply, as the planner's own bounded correction allows. */
const MAX_CORRECTIONS = 1;

function defaults(reason: VibeBatchDefaultsReason, detail: string): VibeBatchValueChoice {
    return { source: 'catalogue-defaults', reason, detail };
}

type AttemptResult =
    | { kind: 'replied'; calls: readonly ToolCallResult[] }
    | { kind: 'budget'; reason: string }
    | { kind: 'failed'; reason: string }
    | { kind: 'stopped' };

function isAbort(error: unknown, signal: AbortSignal): boolean {
    return signal.aborted || (error instanceof Error && error.name === 'AbortError');
}

/**
 * One hosted attempt through the planner's own provider route, so it is estimated, admitted,
 * disclosed and recorded exactly as a planning turn is: the attempt reserves its estimate against
 * the run's `hostedTextPlanningTokens` before anything is sent, and the provider's reported usage
 * settles that reservation through `recordAgentProviderUsage`.
 */
async function requestValues(input: {
    runId: string;
    request: VibeBatchValueRequest;
    userMessage: string;
    signal: AbortSignal;
    lease: { workId: string; cancellationGeneration: number };
}): Promise<AttemptResult> {
    const admission: { refusal: string | null } = { refusal: null };
    try {
        const outcome = await generateToolPlanningOutcome(
            input.request.systemPrompt,
            input.userMessage,
            input.request.tools,
            input.signal,
            input.userMessage,
            (result) => recordAgentProviderUsage(input.runId, result, result.correlationId),
            {
                runId: input.runId,
                requestId: input.lease.workId,
                cancellationGeneration: input.lease.cancellationGeneration,
            },
            ({ correlationId, estimatedTotalTokens, estimate }) => {
                const reservation = agentRunLifecycle.reserveBudget({
                    runId: input.runId,
                    attemptId: correlationId,
                    category: 'hostedTextPlanningTokens',
                    estimate: estimatedTotalTokens,
                    provenance: 'versioned-estimate',
                    estimateMethod: estimate.method,
                });
                if (reservation.status === 'reserved') {
                    return { status: 'admitted' };
                }
                admission.refusal = reservation.reason ?? 'agent budget limit';
                return { status: 'rejected', reason: admission.refusal };
            },
            {
                mode: 'required',
                toolNames: input.request.tools.map((tool) => tool.function.name),
                parallelToolCalls: false,
            },
            {
                firstUserMessage: input.userMessage,
                history: [],
                budgetNote: '',
                messageDataCategories: ['measurement'],
                maxOutputTokens: input.request.maxOutputTokens,
                // A loose reply on a non-strict endpoint reaches the reply reader, which refuses it
                // with a reason the one correction can act on.
                answersSchemaInvalidCalls: true,
            }
        );
        if (admission.refusal !== null) {
            return { kind: 'budget', reason: admission.refusal };
        }
        if (outcome.status === 'rejected') {
            return { kind: 'failed', reason: outcome.reason };
        }
        return { kind: 'replied', calls: outcome.toolCalls };
    } catch (error) {
        if (isAbort(error, input.signal)) {
            return { kind: 'stopped' };
        }
        return { kind: 'failed', reason: error instanceof Error ? error.message : String(error) };
    }
}

function settleAttempt(attempt: Exclude<AttemptResult, { kind: 'replied' }>): VibeBatchValueChoiceOutcome {
    switch (attempt.kind) {
        case 'stopped':
            return { source: 'stopped' };
        case 'budget':
            return defaults('budget', `this run's ${attempt.reason} budget has no room for the request`);
        case 'failed':
            return defaults('failed', attempt.reason);
        default: {
            const exhaustive: never = attempt;
            throw new Error(`Unsupported value attempt: ${String(exhaustive)}`);
        }
    }
}

/** Asks once, corrects at most once, and reads every reply whole through the reply validator. */
async function chooseThroughProvider(input: {
    runId: string;
    request: VibeBatchValueRequest;
    signal: AbortSignal;
    lease: { workId: string; cancellationGeneration: number };
}): Promise<VibeBatchValueChoiceOutcome> {
    const revision = captureProjectRevision();
    const grants = canonicalJson(agentRunLifecycle.get(input.runId)?.grants ?? null);
    let userMessage = input.request.userMessage;
    for (let attempt = 0; ; attempt += 1) {
        const result = await requestValues({ ...input, userMessage });
        if (result.kind !== 'replied') {
            return settleAttempt(result);
        }
        const reply = readVibeBatchValueReply(input.request.pairs, result.calls);
        if (reply.status === 'chosen') {
            return { source: 'measurements', pairs: reply.pairs };
        }
        if (reply.status === 'declined') {
            return defaults('declined', reply.reason);
        }
        const contentCurrent = projectRevisionMatchesLiveIgnoringSaveWrites(revision);
        const correctionAdmitted = admitBoundedAgentCorrection({
            attempt,
            maxAttempts: MAX_CORRECTIONS,
            reservedBudgetAvailable: true,
            cancellationRequested: input.signal.aborted,
            stale: !contentCurrent,
            sameRevision: contentCurrent,
            sameScope: true,
            sameGrants: canonicalJson(agentRunLifecycle.get(input.runId)?.grants ?? null) === grants,
        });
        if (!correctionAdmitted) {
            if (input.signal.aborted) {
                return { source: 'stopped' };
            }
            return defaults('correction-exhausted', reply.reason);
        }
        userMessage = buildVibeBatchCorrectionMessage(input.request, result.calls, reply.reason);
    }
}

/**
 * Chooses a vibe batch's recipe parameter values from its targets' measured baselines, on a hosted
 * chain only. A local chain, a declined, failed or twice-refused reply, or a run with no budget left
 * for the request leaves every value at its catalogue default — the expansion with no values. The
 * request is bound to the run's Stop: a Stop aborts it and is returned as a stop, never as defaults.
 * `onBegin` runs only when a provider request is about to be made.
 */
export async function chooseVibeBatchValues(input: {
    runId: string;
    request: VibeBatchValueRequest;
    onBegin?: () => void;
}): Promise<VibeBatchValueChoiceOutcome> {
    if (!isHostedValueChoiceChain()) {
        return defaults('local-backend', 'the run is not on a hosted backend');
    }
    const workId = `vibe-batch-values-${crypto.randomUUID()}`;
    const claimed = agentRunWorkLease.claim({
        runId: input.runId,
        workId,
        ownerKind: 'provider',
        cleanupOwner: 'provider-adapter',
        idempotencyKey: workId,
        receiptIdentity: workId,
        idempotent: true,
        retriable: false,
        operation: 'read',
    });
    if (claimed.status !== 'claimed') {
        return defaults('failed', `the value request could not be claimed (${claimed.status})`);
    }
    const controller = new AbortController();
    const release = agentRunCancellation.bindAbortController({
        runId: input.runId,
        lease: claimed.lease,
        controller,
        reason: 'Vibe batch value choice cancelled.',
    });
    let terminalState: 'completed' | 'failed' | 'cancelled' = 'failed';
    try {
        input.onBegin?.();
        const outcome = await chooseThroughProvider({
            runId: input.runId,
            request: input.request,
            signal: controller.signal,
            lease: { workId, cancellationGeneration: claimed.lease.cancellationGeneration },
        });
        terminalState = outcome.source === 'stopped' ? 'cancelled' : 'completed';
        return outcome;
    } finally {
        release();
        try {
            agentRunWorkLease.settle({
                runId: claimed.lease.runId,
                workId: claimed.lease.workId,
                leaseId: claimed.lease.leaseId,
                cancellationGeneration: claimed.lease.cancellationGeneration,
                idempotencyKey: claimed.lease.idempotencyKey,
                receiptIdentity: claimed.lease.receiptIdentity,
                terminalState,
            });
        } catch (error) {
            logger.error(new Error('Vibe batch value work could not be settled', { cause: error }));
        }
    }
}
