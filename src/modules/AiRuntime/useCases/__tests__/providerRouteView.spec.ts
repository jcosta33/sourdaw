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
            fallback: { attempted: true, reason: 'remote-unavailable' },
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
            usage: { provenance: 'provider-reported', priceProvenance: 'unavailable' },
        });
    });
});
