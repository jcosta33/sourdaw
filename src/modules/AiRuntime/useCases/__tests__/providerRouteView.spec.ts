import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type AgentDataRetention } from '../../models/AgentDataPolicy';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { getProviderRouteView } from '../getProviderRouteView';
import { createRouteCandidate } from '../llmOrchestration/backendResolution/createRouteCandidate';
import { type ModelRouteCandidate } from '../resolveModelRoute';

const defaultCandidateMocks = vi.hoisted(() => ({
    admission: { webLlm: true },
    isWebGpuAvailable: vi.fn(),
    isCloudAvailable: vi.fn(),
    llmStatus: { value: { state: 'idle' as const } } as {
        value: { state: 'idle' } | { state: 'ready'; backend: 'webllm' | 'cloud'; modelId: string };
    },
    hostedLlmProviderStatus: {
        value: null as null | { provider: 'anthropic'; model: string; baseUrl: null; authentication: 'api-key' },
    },
}));

vi.mock('#/infra/release/modelReleaseAdmission', () => ({
    MODEL_RELEASE_ADMISSION: defaultCandidateMocks.admission,
}));

vi.mock('#/modules/BrowserAi/stores', () => ({
    isWebGpuAvailable: defaultCandidateMocks.isWebGpuAvailable,
}));

vi.mock('#/modules/AiRuntime/repositories/cloudLlm/isCloudAvailable', () => ({
    isCloudAvailable: defaultCandidateMocks.isCloudAvailable,
}));

vi.mock('#/modules/AiRuntime/stores/llmStatusStore', () => ({
    llmStatusStore: defaultCandidateMocks.llmStatus,
}));

vi.mock('#/modules/AiRuntime/stores/hostedLlmProviderStatusStore', () => ({
    hostedLlmProviderStatusStore: defaultCandidateMocks.hostedLlmProviderStatus,
}));

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

    it('admits a cloud run inspected before any provider attempt, with no disclosure recorded yet', () => {
        agentRunLifecycle.create({
            runId: 'route-cloud-pre-attempt',
            request: 'Render the chorus using the configured provider.',
            mode: 'plan',
            createdRevision: 'revision-a',
            requestedRoute: 'cloud',
        });

        const view = getProviderRouteView({
            runId: 'route-cloud-pre-attempt',
            candidates: [WEBLLM_CANDIDATE, CLOUD_CANDIDATE],
        });

        expect(view?.platform).toEqual({ available: true, evidence: 'configured-provider', unavailableReason: null });
        expect(view?.fidelity).toBe('configured-remote');
    });

    it('does not report a fallback attempt for a cancelled single-route run', () => {
        agentRunLifecycle.create({
            runId: 'route-cancelled-single',
            request: 'Render the chorus using the configured provider.',
            mode: 'plan',
            createdRevision: 'revision-a',
            requestedRoute: 'webllm',
        });
        agentRunLifecycle.recordProviderUsage({
            runId: 'route-cancelled-single',
            usage: {
                provider: 'webllm',
                model: 'webllm',
                inputTokens: 0,
                outputTokens: 0,
                provenance: 'provider-reported',
                correlationId: 'corr-1',
                status: 'cancelled',
                executor: 'webllm',
                fallbackReason: 'cancelled',
            },
        });

        const view = getProviderRouteView({
            runId: 'route-cancelled-single',
            candidates: [WEBLLM_CANDIDATE, CLOUD_CANDIDATE],
        });

        expect(view?.fallback).toEqual({ attempted: false, reasons: ['cancelled'] });
    });

    it('reports a fallback attempt when counted usage records span more than one executor', () => {
        agentRunLifecycle.create({
            runId: 'route-cross-executor',
            request: 'Render the chorus using the configured provider.',
            mode: 'plan',
            createdRevision: 'revision-a',
            requestedRoute: 'cloud',
        });
        agentRunLifecycle.recordProviderUsage({
            runId: 'route-cross-executor',
            usage: {
                provider: 'webllm',
                model: 'webllm',
                inputTokens: 0,
                outputTokens: 0,
                provenance: 'provider-reported',
                correlationId: 'corr-1',
                status: 'failed',
                executor: 'webllm',
                fallbackReason: 'unhealthy',
            },
        });
        agentRunLifecycle.recordProviderUsage({
            runId: 'route-cross-executor',
            usage: {
                provider: 'anthropic',
                model: 'fixture-model',
                inputTokens: 100,
                outputTokens: 50,
                provenance: 'provider-reported',
                correlationId: 'corr-2',
                status: 'complete',
                executor: 'cloud',
                routeId: 'cloud',
            },
        });

        const view = getProviderRouteView({
            runId: 'route-cross-executor',
            candidates: [WEBLLM_CANDIDATE, CLOUD_CANDIDATE],
        });

        expect(view?.fallback.attempted).toBe(true);
    });

    it('does not report a fallback attempt for a single-executor auto run', () => {
        agentRunLifecycle.create({
            runId: 'route-auto-single',
            request: 'Render the chorus using the configured provider.',
            mode: 'plan',
            createdRevision: 'revision-a',
            requestedRoute: 'auto',
        });
        agentRunLifecycle.recordProviderUsage({
            runId: 'route-auto-single',
            usage: {
                provider: 'webllm',
                model: 'webllm',
                inputTokens: 0,
                outputTokens: 0,
                provenance: 'provider-reported',
                correlationId: 'corr-1',
                status: 'complete',
                executor: 'webllm',
                fallbackReason: 'unhealthy',
            },
        });

        const view = getProviderRouteView({
            runId: 'route-auto-single',
            candidates: [WEBLLM_CANDIDATE, CLOUD_CANDIDATE],
        });

        expect(view?.fallback.attempted).toBe(false);
    });

    it('reports a fallback attempt for an auto run whose counted usage spans executors', () => {
        agentRunLifecycle.create({
            runId: 'route-auto-cross-executor',
            request: 'Render the chorus using the configured provider.',
            mode: 'plan',
            createdRevision: 'revision-a',
            requestedRoute: 'auto',
        });
        agentRunLifecycle.recordProviderUsage({
            runId: 'route-auto-cross-executor',
            usage: {
                provider: 'webllm',
                model: 'webllm',
                inputTokens: 0,
                outputTokens: 0,
                provenance: 'provider-reported',
                correlationId: 'corr-1',
                status: 'failed',
                executor: 'webllm',
                fallbackReason: 'unhealthy',
            },
        });
        agentRunLifecycle.recordProviderUsage({
            runId: 'route-auto-cross-executor',
            usage: {
                provider: 'anthropic',
                model: 'fixture-model',
                inputTokens: 100,
                outputTokens: 50,
                provenance: 'provider-reported',
                correlationId: 'corr-2',
                status: 'complete',
                executor: 'cloud',
                routeId: 'cloud',
            },
        });

        const view = getProviderRouteView({
            runId: 'route-auto-cross-executor',
            candidates: [WEBLLM_CANDIDATE, CLOUD_CANDIDATE],
        });

        expect(view?.fallback.attempted).toBe(true);
    });

    it('ignores a counted record with no executor when deciding a single-route attempt', () => {
        agentRunLifecycle.create({
            runId: 'route-executorless-record',
            request: 'Render the chorus using the configured provider.',
            mode: 'plan',
            createdRevision: 'revision-a',
            requestedRoute: 'webllm',
        });
        agentRunLifecycle.recordProviderUsage({
            runId: 'route-executorless-record',
            usage: {
                provider: 'webllm',
                model: 'webllm',
                inputTokens: 0,
                outputTokens: 0,
                provenance: 'provider-reported',
                correlationId: 'corr-1',
                status: 'complete',
            },
        });
        agentRunLifecycle.recordProviderUsage({
            runId: 'route-executorless-record',
            usage: {
                provider: 'webllm',
                model: 'webllm',
                inputTokens: 10,
                outputTokens: 5,
                provenance: 'provider-reported',
                correlationId: 'corr-2',
                status: 'complete',
                executor: 'webllm',
            },
        });

        const view = getProviderRouteView({
            runId: 'route-executorless-record',
            candidates: [WEBLLM_CANDIDATE, CLOUD_CANDIDATE],
        });

        expect(view?.fallback.attempted).toBe(false);
    });

    describe('default candidates', () => {
        beforeEach(() => {
            vi.clearAllMocks();
            defaultCandidateMocks.admission.webLlm = true;
            defaultCandidateMocks.llmStatus.value = { state: 'idle' };
            defaultCandidateMocks.hostedLlmProviderStatus.value = null;
            defaultCandidateMocks.isWebGpuAvailable.mockReturnValue(false);
            defaultCandidateMocks.isCloudAvailable.mockReturnValue(false);
        });

        it('projects the real webllm candidate when no candidates are supplied and WebGPU is ready', () => {
            defaultCandidateMocks.isWebGpuAvailable.mockReturnValue(true);
            defaultCandidateMocks.llmStatus.value = { state: 'ready', backend: 'webllm', modelId: 'webllm-fixture' };
            const expectedCandidate = createRouteCandidate('webllm');
            agentRunLifecycle.create({
                runId: 'route-default-webllm',
                request: 'Analyze the master locally.',
                mode: 'explain',
                createdRevision: 'revision-a',
                requestedRoute: 'webllm',
            });

            const view = getProviderRouteView({ runId: 'route-default-webllm' });

            expect(view?.platform).toEqual({
                available: true,
                evidence: expectedCandidate.platform.evidence,
                unavailableReason: null,
            });
            expect(view?.fidelity).toBe(expectedCandidate.trust);
            expect(view?.capability).toEqual(expectedCandidate.capabilities);
        });

        it('projects the real cloud candidate when no candidates are supplied and the cloud session is available', () => {
            defaultCandidateMocks.isCloudAvailable.mockReturnValue(true);
            defaultCandidateMocks.hostedLlmProviderStatus.value = {
                provider: 'anthropic',
                model: 'fixture-model',
                baseUrl: null,
                authentication: 'api-key',
            };
            const expectedCandidate = createRouteCandidate('cloud');
            agentRunLifecycle.create({
                runId: 'route-default-cloud',
                request: 'Render the chorus using the configured provider.',
                mode: 'plan',
                createdRevision: 'revision-a',
                requestedRoute: 'cloud',
            });

            const view = getProviderRouteView({ runId: 'route-default-cloud' });

            expect(view?.platform).toEqual({
                available: true,
                evidence: expectedCandidate.platform.evidence,
                unavailableReason: null,
            });
            expect(view?.fidelity).toBe(expectedCandidate.trust);
            expect(view?.capability).toEqual(expectedCandidate.capabilities);
        });
    });
});
