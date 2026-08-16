import { describe, expect, it } from 'vitest';

import { agentRunLifecycle } from '../agentRunLifecycle';
import { getProviderRouteView } from '../providerRouteView';

describe('provider route view', () => {
    it('discloses requested and actual routes, fallback, capability, policy, and usage provenance', () => {
        agentRunLifecycle.clear();
        agentRunLifecycle.create({
            runId: 'route-run',
            request: 'Plan',
            mode: 'macro',
            createdRevision: 'revision-a',
            requestedRoute: 'cloud',
        });
        agentRunLifecycle.recordProviderUsage({
            runId: 'route-run',
            usage: {
                provider: 'openai',
                model: 'tool-model',
                inputTokens: 1,
                outputTokens: 2,
                cachedInputTokens: 4,
                provenance: 'provider-reported',
                status: 'complete',
                fallbackReason: 'remote-unavailable',
                executor: 'native',
                disclosure: {
                    requestId: 'request',
                    categories: ['prompt-text'],
                    retention: {
                        applicationState: 'unknown',
                        abuseMonitoring: 'unknown',
                        promptCache: 'unknown',
                        safetyLegalException: 'unknown',
                        unknown: 'unknown',
                    },
                },
            },
        });
        expect(getProviderRouteView(agentRunLifecycle.get('route-run')!)).toEqual({
            requestedRoute: 'remote',
            actualRoute: 'native-local',
            availability: { status: 'available', reason: null },
            capability: { role: 'tool-planning', fidelity: 'tool-model' },
            fallback: {
                attempted: true,
                reason: 'remote-unavailable',
                attempts: [
                    {
                        provider: 'openai',
                        model: 'tool-model',
                        correlationId: null,
                        status: 'complete',
                        reason: 'remote-unavailable',
                    },
                ],
            },
            dataPolicy: {
                categories: ['prompt-text'],
                retention: {
                    applicationState: 'unknown',
                    abuseMonitoring: 'unknown',
                    promptCache: 'unknown',
                    safetyLegalException: 'unknown',
                    unknown: 'unknown',
                },
            },
            cache: { status: 'used', provenance: 'provider-reported' },
            usage: { provenance: 'provider-reported', priceProvenance: 'unavailable' },
        });
    });

    it('does not invent an actual route when no provider attempt reached durable run truth', () => {
        agentRunLifecycle.clear();
        agentRunLifecycle.create({
            runId: 'unattempted-route-run',
            request: 'Explain the mix.',
            mode: 'explain',
            createdRevision: 'revision-a',
            requestedRoute: 'cloud',
        });

        expect(getProviderRouteView(agentRunLifecycle.get('unattempted-route-run')!)).toMatchObject({
            requestedRoute: 'remote',
            actualRoute: null,
            availability: { status: 'unavailable', reason: 'no-provider-attempt' },
            cache: { status: 'unavailable', provenance: 'unavailable' },
            usage: { provenance: 'unavailable', priceProvenance: 'unavailable' },
        });
    });

    it('retains ordered fallback attempts and marks a terminal failure unavailable', () => {
        agentRunLifecycle.clear();
        agentRunLifecycle.create({
            runId: 'failed-route-run',
            request: 'Plan',
            mode: 'macro',
            createdRevision: 'revision-a',
        });
        agentRunLifecycle.recordProviderUsage({
            runId: 'failed-route-run',
            usage: {
                provider: 'native',
                model: 'native',
                inputTokens: null,
                outputTokens: null,
                provenance: 'unavailable',
                correlationId: 'native-1',
                status: 'failed',
                fallbackReason: 'native-unavailable',
                executor: 'native',
            },
        });
        agentRunLifecycle.recordProviderUsage({
            runId: 'failed-route-run',
            usage: {
                provider: 'webllm',
                model: 'webllm',
                inputTokens: null,
                outputTokens: null,
                provenance: 'unavailable',
                correlationId: 'webllm-2',
                status: 'cancelled',
                fallbackReason: 'cancelled',
                executor: 'webllm',
            },
        });
        expect(getProviderRouteView(agentRunLifecycle.get('failed-route-run')!)).toMatchObject({
            actualRoute: 'browser-local',
            availability: { status: 'unavailable', reason: 'cancelled' },
            fallback: {
                attempted: true,
                reason: 'cancelled',
                attempts: [{ correlationId: 'native-1' }, { correlationId: 'webllm-2' }],
            },
        });
    });
});
