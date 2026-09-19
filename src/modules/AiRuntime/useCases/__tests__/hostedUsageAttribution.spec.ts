import { afterEach, describe, expect, it } from 'vitest';

import { REMOTE_TEXT_AGENT_DATA_CATEGORIES } from '../../models/AgentDataPolicy';
import { type HostedToolPlan } from '../../repositories/cloudLlm/cloudInference/hostedToolPlan';
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
function reportHostedToolPlan(plan: HostedToolPlan): void {
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
                reasoningTokens: null,
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
            strictToolSchemas: true,
            usage: { inputTokens: 120, outputTokens: 30, cacheReadInputTokens: 40, cacheWriteInputTokens: 8 },
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
});
