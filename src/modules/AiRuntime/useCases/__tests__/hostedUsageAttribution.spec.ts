import { afterEach, describe, expect, it } from 'vitest';

import { REMOTE_TEXT_AGENT_DATA_CATEGORIES } from '../../models/AgentDataPolicy';
import { type ModelProviderName, type ModelProviderResult } from '../../models/ModelProviderProtocol';
import {
    type HostedToolPlan,
    type HostedToolPlanUsage,
} from '../../repositories/cloudLlm/cloudInference/hostedToolPlan';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { createModelProviderStreamWriter } from '../createModelProviderStreamWriter';
import { remoteTransmissionDisclosure } from '../discloseRemoteTransmission';
import { recordAgentProviderUsage } from '../recordAgentProviderUsage';

import { readyRequest } from './modelProviderProtocolFixture';

const RUN_ID = 'run-1';
const BUDGET_ATTEMPT_ID = 'attempt-1';

function buildRemoteDisclosure() {
    return remoteTransmissionDisclosure.issue({
        categories: REMOTE_TEXT_AGENT_DATA_CATEGORIES,
        correlationId: 'correlation-1',
        requestId: 'request-1',
    });
}

/**
 * What `useCases/llmOrchestration/inference.ts` does for a completed cloud tool-planning
 * call: push the hosted plan's usage as a `final`, `provider-reported` event before
 * `finish()`, then merge the plan's `strictToolSchemas`/`cacheWriteInputTokens` onto the
 * reported result. This mirrors that exact sequence against the real protocol session and
 * the real `agentRunLifecycle` store, rather than assuming the wiring works.
 */
function reportHostedToolPlan(plan: HostedToolPlan): ModelProviderResult {
    const { protocol, request } = readyRequest({
        provider: 'anthropic',
        operation: 'tools',
        dataPolicy: 'remote-allowed',
        dataCategories: [...REMOTE_TEXT_AGENT_DATA_CATEGORIES],
        remoteDisclosure: buildRemoteDisclosure(),
    });
    const session = protocol.start(request);
    const source = createModelProviderStreamWriter(request, session);

    agentRunLifecycle.reserveBudget({
        runId: RUN_ID,
        attemptId: BUDGET_ATTEMPT_ID,
        category: 'remoteTokens',
        estimate: 0,
        provenance: 'versioned-estimate',
    });

    if (plan.usage) {
        source.push({
            type: 'usage',
            mode: 'final',
            usage: {
                inputTokens: plan.usage.inputTokens,
                outputTokens: plan.usage.outputTokens,
                cachedInputTokens: plan.usage.cacheReadInputTokens,
                reasoningTokens: plan.usage.reasoningTokens,
            },
            provenance: 'provider-reported',
        });
    }
    const normalizedResult = source.finish({ reason: 'stop' });
    const reportedResult = {
        ...normalizedResult,
        strictToolSchemas: plan.strictToolSchemas,
        cacheWriteInputTokens: plan.usage?.cacheWriteInputTokens ?? null,
    };

    recordAgentProviderUsage(RUN_ID, reportedResult, BUDGET_ATTEMPT_ID);
    return reportedResult;
}

/**
 * What `useCases/llmOrchestration/inference.ts` does when a hosted turn is rejected after
 * the provider answered: push the `ToolPlanningRejectedError`'s carried usage as a `final`,
 * `provider-reported` event before `finish({reason:'error', ...})`, so the run's cost
 * projection still reflects the tokens the provider actually spent on the refused turn.
 */
function reportRejectedToolPlan(provider: ModelProviderName, usage: HostedToolPlanUsage | null): void {
    const { protocol, request } = readyRequest({
        provider,
        operation: 'tools',
        dataPolicy: 'remote-allowed',
        dataCategories: [...REMOTE_TEXT_AGENT_DATA_CATEGORIES],
        remoteDisclosure: buildRemoteDisclosure(),
    });
    const session = protocol.start(request);
    const source = createModelProviderStreamWriter(request, session);

    agentRunLifecycle.reserveBudget({
        runId: RUN_ID,
        attemptId: BUDGET_ATTEMPT_ID,
        category: 'remoteTokens',
        estimate: 0,
        provenance: 'versioned-estimate',
    });

    if (usage) {
        source.push({
            type: 'usage',
            mode: 'final',
            usage: {
                inputTokens: usage.inputTokens,
                outputTokens: usage.outputTokens,
                cachedInputTokens: usage.cacheReadInputTokens,
                reasoningTokens: usage.reasoningTokens,
            },
            provenance: 'provider-reported',
        });
    }
    const failedResult = source.finish({
        reason: 'error',
        failure: {
            code: 'tool-planning-rejected',
            retryable: false,
            safeMessage: 'The model provider rejected tool planning.',
        },
    });

    recordAgentProviderUsage(RUN_ID, failedResult, BUDGET_ATTEMPT_ID);
}

describe('hosted tool-planning usage attribution', () => {
    afterEach(() => {
        agentRunLifecycle.clear();
    });

    it('carries a provider-reported usage figure into the run cost projection', () => {
        agentRunLifecycle.create({
            runId: RUN_ID,
            request: 'set the tempo',
            mode: 'plan',
            createdRevision: null,
            requestedRoute: 'cloud',
        });

        reportHostedToolPlan({
            providerRequestId: 'msg_1',
            calls: [],
            assistantItems: [],
            strictToolSchemas: true,
            usage: {
                inputTokens: 120,
                outputTokens: 30,
                cacheReadInputTokens: 40,
                cacheWriteInputTokens: 8,
                reasoningTokens: null,
            },
        });

        const run = agentRunLifecycle.get(RUN_ID);
        expect(run).not.toBeNull();
        expect(run?.providerUsage[0]).toMatchObject({
            provider: 'anthropic',
            inputTokens: 120,
            outputTokens: 30,
            cachedInputTokens: 40,
            provenance: 'provider-reported',
            strictToolSchemas: true,
            cacheWriteInputTokens: 8,
        });

        // getProviderRouteView's getCostProjection reads exactly these four fields off
        // run.budgetAttempts to build the run's reported cost figure; asserting here
        // proves the figure is provider-reported without the unrelated WebGPU/cloud
        // route-candidate mocking getProviderRouteView itself requires.
        expect(run?.budgetAttempts[0]).toMatchObject({
            category: 'remoteTokens',
            provenance: 'provider-reported',
            actual: 150,
            final: true,
        });
    });

    it('forwards a plan-reported thinking figure as the reported usage reasoning tokens', () => {
        agentRunLifecycle.create({
            runId: RUN_ID,
            request: 'set the tempo',
            mode: 'plan',
            createdRevision: null,
            requestedRoute: 'cloud',
        });

        const reported = reportHostedToolPlan({
            providerRequestId: 'msg_1',
            calls: [],
            assistantItems: [],
            strictToolSchemas: true,
            usage: {
                inputTokens: 120,
                outputTokens: 30,
                cacheReadInputTokens: 40,
                cacheWriteInputTokens: 8,
                reasoningTokens: 5,
            },
        });

        expect(reported.usage).toMatchObject({ reasoningTokens: 5, provenance: 'provider-reported' });
    });

    it('reports no cache-write figure and a false strictToolSchemas for a non-strict plan with no usage event', () => {
        agentRunLifecycle.create({
            runId: RUN_ID,
            request: 'set the tempo',
            mode: 'plan',
            createdRevision: null,
            requestedRoute: 'cloud',
        });

        reportHostedToolPlan({
            providerRequestId: 'chatcmpl_1',
            calls: [],
            assistantItems: [],
            strictToolSchemas: false,
            usage: null,
        });

        const run = agentRunLifecycle.get(RUN_ID);
        expect(run?.providerUsage[0]).toMatchObject({
            strictToolSchemas: false,
            cacheWriteInputTokens: null,
        });
        // No usage event was pushed, so the session's own default "unavailable"
        // provenance stands: never a fabricated "provider-reported" claim for a
        // figure the provider never sent.
        expect(run?.providerUsage[0]?.provenance).toBe('unavailable');
    });

    it.each<[ModelProviderName, HostedToolPlanUsage]>([
        [
            'anthropic',
            {
                inputTokens: 30,
                outputTokens: 12,
                cacheReadInputTokens: 0,
                cacheWriteInputTokens: 0,
                reasoningTokens: 21,
            },
        ],
        [
            'openai',
            {
                inputTokens: 40,
                outputTokens: 7,
                cacheReadInputTokens: 12,
                cacheWriteInputTokens: null,
                reasoningTokens: null,
            },
        ],
        [
            'openai-compatible',
            {
                inputTokens: 18,
                outputTokens: 5,
                cacheReadInputTokens: 0,
                cacheWriteInputTokens: null,
                reasoningTokens: null,
            },
        ],
    ])(
        'attributes %s usage from a refused turn to the run even though the outcome is a rejection',
        (provider, usage) => {
            agentRunLifecycle.create({
                runId: RUN_ID,
                request: 'set the tempo',
                mode: 'plan',
                createdRevision: null,
                requestedRoute: 'cloud',
            });

            reportRejectedToolPlan(provider, usage);

            const run = agentRunLifecycle.get(RUN_ID);
            expect(run).not.toBeNull();
            expect(run?.providerUsage[0]).toMatchObject({
                provider,
                inputTokens: usage.inputTokens,
                outputTokens: usage.outputTokens,
                cachedInputTokens: usage.cacheReadInputTokens,
                provenance: 'provider-reported',
            });
        }
    );
});
