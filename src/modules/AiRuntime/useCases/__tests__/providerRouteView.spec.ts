import { beforeEach, describe, expect, it } from 'vitest';

import { type AgentDataRetention } from '../../models/AgentDataPolicy';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { getProviderRouteView } from '../getProviderRouteView';
import { type ModelRouteCandidate } from '../resolveModelRoute';

const UNKNOWN_RETENTION: AgentDataRetention = {
    applicationState: 'unknown',
    abuseMonitoring: 'unknown',
    promptCache: 'unknown',
    safetyLegalException: 'unknown',
    unknown: 'unknown',
};

const WEBLLM_CANDIDATE: ModelRouteCandidate = {
    routeId: 'webllm',
    executor: 'webllm',
    providerId: 'webllm',
    modelId: 'webllm',
    protocolFamily: 'webllm-browser',
    capabilities: { operations: ['text', 'tools', 'structured-output'], modalities: ['text'], streaming: true },
    trust: 'release-owned-local',
    dataClass: 'local-private',
    cost: 'local',
    platform: { available: true, evidence: 'webgpu' },
    modelInstalled: true,
    health: 'healthy',
};

const CLOUD_CANDIDATE: ModelRouteCandidate = {
    routeId: 'cloud',
    executor: 'cloud',
    providerId: 'anthropic',
    modelId: 'fixture-model',
    protocolFamily: 'anthropic-messages',
    capabilities: { operations: ['text', 'tools', 'structured-output'], modalities: ['text'], streaming: true },
    trust: 'configured-remote',
    dataClass: 'remote-export',
    cost: 'paid',
    platform: { available: true, evidence: 'configured-provider' },
    modelInstalled: true,
    health: 'healthy',
};

describe('provider route view', () => {
    beforeEach(() => {
        agentRunLifecycle.clear();
    });

    it('projects a completed cloud run with a webllm fallback attempt and a prompt-text disclosure', () => {
        agentRunLifecycle.create({
            runId: 'route-cloud',
            request: 'Render the chorus using the configured provider.',
            mode: 'macro',
            createdRevision: 'revision-a',
            requestedRoute: 'cloud',
        });
        agentRunLifecycle.recordProviderUsage({
            runId: 'route-cloud',
            usage: {
                provider: 'webllm',
                model: 'webllm',
                inputTokens: 0,
                outputTokens: 0,
                provenance: 'provider-reported',
                correlationId: 'corr-webllm-1',
                status: 'failed',
                executor: 'webllm',
                fallbackReason: 'unhealthy',
            },
        });
        agentRunLifecycle.recordProviderUsage({
            runId: 'route-cloud',
            usage: {
                provider: 'anthropic',
                model: 'fixture-model',
                inputTokens: 100,
                outputTokens: 50,
                cachedInputTokens: 10,
                provenance: 'provider-reported',
                correlationId: 'corr-cloud-1',
                status: 'complete',
                executor: 'cloud',
                routeId: 'cloud',
                disclosure: { requestId: 'req-1', categories: ['prompt-text'], retention: UNKNOWN_RETENTION },
            },
        });

        const view = getProviderRouteView({
            runId: 'route-cloud',
            candidates: [WEBLLM_CANDIDATE, CLOUD_CANDIDATE],
        });

        expect(view).toEqual({
            runId: 'route-cloud',
            requested: { route: 'cloud', locality: 'remote' },
            actual: {
                routeId: 'cloud',
                executor: 'cloud',
                locality: 'remote',
                provider: 'anthropic',
                model: 'fixture-model',
            },
            platform: { available: true, evidence: 'configured-provider', unavailableReason: null },
            capability: { operations: ['text', 'tools', 'structured-output'], modalities: ['text'], streaming: true },
            fidelity: 'configured-remote',
            fallback: { attempted: true, reasons: ['unhealthy'] },
            dataDisclosure: { categories: ['prompt-text'], retention: UNKNOWN_RETENTION },
            usage: {
                provenance: 'provider-reported',
                inputTokens: 100,
                outputTokens: 50,
                cachedInputTokens: 10,
                attempts: 2,
            },
            cost: [],
        });
    });

    it('reports the weakest counted provenance when the cloud attempt is only a versioned estimate', () => {
        agentRunLifecycle.create({
            runId: 'route-cloud-versioned',
            request: 'Render the chorus using the configured provider.',
            mode: 'macro',
            createdRevision: 'revision-a',
            requestedRoute: 'cloud',
        });
        agentRunLifecycle.recordProviderUsage({
            runId: 'route-cloud-versioned',
            usage: {
                provider: 'webllm',
                model: 'webllm',
                inputTokens: 0,
                outputTokens: 0,
                provenance: 'provider-reported',
                correlationId: 'corr-webllm-2',
                status: 'failed',
                executor: 'webllm',
                fallbackReason: 'unhealthy',
            },
        });
        agentRunLifecycle.recordProviderUsage({
            runId: 'route-cloud-versioned',
            usage: {
                provider: 'anthropic',
                model: 'fixture-model',
                inputTokens: 100,
                outputTokens: 50,
                provenance: 'versioned-estimate',
                correlationId: 'corr-cloud-2',
                status: 'complete',
                executor: 'cloud',
                routeId: 'cloud',
            },
        });

        const view = getProviderRouteView({
            runId: 'route-cloud-versioned',
            candidates: [WEBLLM_CANDIDATE, CLOUD_CANDIDATE],
        });

        expect(view?.usage).toMatchObject({ provenance: 'versioned-estimate', attempts: 2 });
    });

    it('excludes an unavailable-status usage entry from the actual route and usage totals', () => {
        agentRunLifecycle.create({
            runId: 'route-unavailable',
            request: 'Render the chorus using the configured provider.',
            mode: 'plan',
            createdRevision: 'revision-a',
            requestedRoute: 'cloud',
        });
        agentRunLifecycle.recordProviderUsage({
            runId: 'route-unavailable',
            usage: {
                provider: 'anthropic',
                model: 'fixture-model',
                inputTokens: 5,
                outputTokens: 5,
                provenance: 'provider-reported',
                correlationId: 'corr-1',
                status: 'unavailable',
                executor: 'cloud',
            },
        });

        const view = getProviderRouteView({
            runId: 'route-unavailable',
            candidates: [WEBLLM_CANDIDATE, CLOUD_CANDIDATE],
        });

        expect(view?.actual).toEqual({
            routeId: null,
            executor: null,
            locality: 'unknown',
            provider: null,
            model: null,
        });
        expect(view?.usage).toEqual({
            provenance: 'unavailable',
            inputTokens: 0,
            outputTokens: 0,
            cachedInputTokens: 0,
            attempts: 0,
        });
    });

    it('projects a local-only webllm run with browser-local fidelity and no data disclosure', () => {
        agentRunLifecycle.create({
            runId: 'route-webllm',
            request: 'Analyze the master locally.',
            mode: 'explain',
            createdRevision: 'revision-a',
            requestedRoute: 'webllm',
        });
        agentRunLifecycle.recordProviderUsage({
            runId: 'route-webllm',
            usage: {
                provider: 'webllm',
                model: 'webllm',
                inputTokens: 20,
                outputTokens: 10,
                provenance: 'provider-reported',
                correlationId: 'corr-1',
                status: 'complete',
                executor: 'webllm',
                routeId: 'webllm',
            },
        });

        const view = getProviderRouteView({
            runId: 'route-webllm',
            candidates: [WEBLLM_CANDIDATE, CLOUD_CANDIDATE],
        });

        expect(view?.actual.locality).toBe('browser-local');
        expect(view?.dataDisclosure).toBeNull();
        expect(view?.fidelity).toBe('release-owned-local');
    });

    it('reports platform-unavailable as the requested route rejection when the cloud platform is down', () => {
        agentRunLifecycle.create({
            runId: 'route-cloud-unavailable',
            request: 'Render the chorus using the configured provider.',
            mode: 'plan',
            createdRevision: 'revision-a',
            requestedRoute: 'cloud',
        });
        agentRunLifecycle.recordProviderUsage({
            runId: 'route-cloud-unavailable',
            usage: {
                provider: 'anthropic',
                model: 'fixture-model',
                inputTokens: 0,
                outputTokens: 0,
                provenance: 'provider-reported',
                correlationId: 'corr-1',
                status: 'complete',
                disclosure: { requestId: 'req-1', categories: ['prompt-text'], retention: UNKNOWN_RETENTION },
            },
        });
        const cloudUnavailable: ModelRouteCandidate = {
            ...CLOUD_CANDIDATE,
            platform: { available: false, evidence: null },
        };

        const view = getProviderRouteView({
            runId: 'route-cloud-unavailable',
            candidates: [WEBLLM_CANDIDATE, cloudUnavailable],
        });

        expect(view?.platform).toEqual({ available: false, evidence: null, unavailableReason: 'platform-unavailable' });
        expect(view?.capability).toBeNull();
        expect(view?.fidelity).toBeNull();
    });

    it('returns null for an unknown run', () => {
        expect(getProviderRouteView({ runId: 'does-not-exist' })).toBeNull();
    });

    it('never leaks correlation ids or request identities and exposes only the documented keys', () => {
        agentRunLifecycle.create({
            runId: 'route-presentation-safety',
            request: 'Render the chorus using the configured provider.',
            mode: 'macro',
            createdRevision: 'revision-a',
            requestedRoute: 'cloud',
        });
        agentRunLifecycle.recordProviderUsage({
            runId: 'route-presentation-safety',
            usage: {
                provider: 'webllm',
                model: 'webllm',
                inputTokens: 0,
                outputTokens: 0,
                provenance: 'provider-reported',
                correlationId: 'corr-webllm-secret',
                status: 'failed',
                executor: 'webllm',
                fallbackReason: 'unhealthy',
            },
        });
        agentRunLifecycle.recordProviderUsage({
            runId: 'route-presentation-safety',
            usage: {
                provider: 'anthropic',
                model: 'fixture-model',
                inputTokens: 100,
                outputTokens: 50,
                cachedInputTokens: 10,
                provenance: 'provider-reported',
                correlationId: 'corr-cloud-secret',
                status: 'complete',
                executor: 'cloud',
                routeId: 'cloud',
                disclosure: { requestId: 'req-secret', categories: ['prompt-text'], retention: UNKNOWN_RETENTION },
            },
        });

        const view = getProviderRouteView({
            runId: 'route-presentation-safety',
            candidates: [WEBLLM_CANDIDATE, CLOUD_CANDIDATE],
        });
        const serialized = JSON.stringify(view);

        expect(serialized).not.toContain('corr-webllm-secret');
        expect(serialized).not.toContain('corr-cloud-secret');
        expect(serialized).not.toContain('req-secret');
        expect(serialized).not.toContain('correlationId');
        expect(serialized).not.toContain('safeMessage');
        expect(serialized).not.toContain('requestId');
        expect(Object.keys(view!).sort()).toEqual([
            'actual',
            'capability',
            'cost',
            'dataDisclosure',
            'fallback',
            'fidelity',
            'platform',
            'requested',
            'runId',
            'usage',
        ]);
    });

    it('maps budget attempts to ordered cost rows carrying their provenance and final flag', () => {
        agentRunLifecycle.create({
            runId: 'route-cost',
            request: 'Render the chorus using the configured provider.',
            mode: 'plan',
            createdRevision: 'revision-a',
            requestedRoute: 'webllm',
            budgets: { limits: { remoteTokens: 1_000 }, consumed: {} },
        });
        agentRunLifecycle.reserveBudgetBatch({
            runId: 'route-cost',
            attempts: [
                { attemptId: 'attempt-1', category: 'remoteTokens', estimate: 10, provenance: 'versioned-estimate' },
            ],
        });
        agentRunLifecycle.reconcileBudgetAttempt({
            runId: 'route-cost',
            attemptId: 'attempt-1',
            consumed: 12,
            mode: 'final',
            provenance: 'provider-reported',
        });
        agentRunLifecycle.reserveBudgetBatch({
            runId: 'route-cost',
            attempts: [
                { attemptId: 'attempt-2', category: 'renderJobs', estimate: 1, provenance: 'versioned-estimate' },
            ],
        });

        const view = getProviderRouteView({
            runId: 'route-cost',
            candidates: [WEBLLM_CANDIDATE, CLOUD_CANDIDATE],
        });

        expect(view?.cost).toEqual([
            { category: 'remoteTokens', reserved: 12, actual: 12, provenance: 'provider-reported', final: true },
            { category: 'renderJobs', reserved: 1, actual: 0, provenance: 'versioned-estimate', final: false },
        ]);
    });
});
