import { describe, expect, it } from 'vitest';

import { resolveModelRoute } from '../resolveModelRoute';

const LOCAL_ROUTE = {
    routeId: 'webllm:hermes-3',
    executor: 'webllm' as const,
    providerId: 'webllm',
    modelId: 'hermes-3',
    protocolFamily: 'openai-chat-completions',
    capabilities: {
        operations: ['text', 'tools', 'structured-output'] as const,
        modalities: ['text'] as const,
        streaming: true,
    },
    trust: 'release-owned-local' as const,
    dataClass: 'local-private' as const,
    cost: 'local' as const,
    platform: { available: true, evidence: 'webgpu' },
    modelInstalled: true,
    health: 'healthy' as const,
};

const REMOTE_ROUTE = {
    routeId: 'openai:gpt-5-mini',
    executor: 'cloud' as const,
    providerId: 'openai',
    modelId: 'gpt-5-mini',
    protocolFamily: 'openai-chat-completions',
    capabilities: {
        operations: ['text', 'tools', 'structured-output'] as const,
        modalities: ['text'] as const,
        streaming: true,
    },
    trust: 'configured-remote' as const,
    dataClass: 'remote-export' as const,
    cost: 'paid' as const,
    platform: { available: true, evidence: 'compiled-adapter' },
    modelInstalled: true,
    health: 'healthy' as const,
};

const REQUIREMENTS = {
    operation: 'tools' as const,
    modality: 'text' as const,
    streaming: false,
    allowedTrust: ['release-owned-local', 'configured-remote'] as const,
    dataPolicy: 'remote-allowed' as const,
    costPolicy: 'allow-paid-remote' as const,
    requireInstalledModel: true,
};

describe('resolveModelRoute', () => {
    it('selects the first fully admitted route while retaining the requested route and ordered chain', () => {
        expect(
            resolveModelRoute({
                requestedRoute: 'auto',
                requirements: REQUIREMENTS,
                candidates: [LOCAL_ROUTE, REMOTE_ROUTE],
            })
        ).toEqual({
            status: 'ready',
            requestedRoute: 'auto',
            selectedRouteId: LOCAL_ROUTE.routeId,
            routes: [LOCAL_ROUTE, REMOTE_ROUTE],
            rejected: [],
        });
    });

    it('fails an exact unavailable request closed without silently falling back', () => {
        expect(
            resolveModelRoute({
                requestedRoute: LOCAL_ROUTE.routeId,
                requirements: REQUIREMENTS,
                candidates: [{ ...LOCAL_ROUTE, health: 'unavailable' }, REMOTE_ROUTE],
            })
        ).toEqual({
            status: 'unavailable',
            requestedRoute: LOCAL_ROUTE.routeId,
            routes: [],
            rejected: [{ routeId: LOCAL_ROUTE.routeId, reasons: ['unhealthy'] }],
        });
    });

    it('reports an unknown exact route instead of silently selecting another candidate', () => {
        expect(
            resolveModelRoute({
                requestedRoute: 'missing-provider:model',
                requirements: REQUIREMENTS,
                candidates: [LOCAL_ROUTE, REMOTE_ROUTE],
            })
        ).toEqual({
            status: 'unavailable',
            requestedRoute: 'missing-provider:model',
            routes: [],
            rejected: [{ routeId: 'missing-provider:model', reasons: ['unknown-route'] }],
        });
    });

    it('rejects duplicate route identities before selection', () => {
        expect(
            resolveModelRoute({
                requestedRoute: 'auto',
                requirements: REQUIREMENTS,
                candidates: [LOCAL_ROUTE, { ...LOCAL_ROUTE, modelId: 'different-model' }],
            })
        ).toEqual({
            status: 'unavailable',
            requestedRoute: 'auto',
            routes: [],
            rejected: [{ routeId: LOCAL_ROUTE.routeId, reasons: ['duplicate-route'] }],
        });
    });

    it('prohibits a local-private request from exporting data during fallback', () => {
        const resolution = resolveModelRoute({
            requestedRoute: 'auto',
            requirements: { ...REQUIREMENTS, dataPolicy: 'local-only' },
            candidates: [{ ...LOCAL_ROUTE, health: 'unavailable' }, REMOTE_ROUTE],
        });

        expect(resolution.status).toBe('unavailable');
        expect(resolution.rejected).toEqual([
            { routeId: LOCAL_ROUTE.routeId, reasons: ['unhealthy'] },
            { routeId: REMOTE_ROUTE.routeId, reasons: ['data-policy'] },
        ]);
    });

    it('filters capability, trust, cost, platform, installation, and health before selection', () => {
        const resolution = resolveModelRoute({
            requestedRoute: 'auto',
            requirements: {
                ...REQUIREMENTS,
                allowedTrust: ['release-owned-local'] as const,
                costPolicy: 'local-only',
            },
            candidates: [
                {
                    ...LOCAL_ROUTE,
                    routeId: 'missing-capability',
                    capabilities: { ...LOCAL_ROUTE.capabilities, operations: ['text'] as const },
                },
                { ...REMOTE_ROUTE, routeId: 'wrong-trust' },
                { ...LOCAL_ROUTE, routeId: 'wrong-cost', cost: 'paid' as const },
                { ...LOCAL_ROUTE, routeId: 'no-platform', platform: { available: false, evidence: null } },
                { ...LOCAL_ROUTE, routeId: 'not-installed', modelInstalled: false },
                { ...LOCAL_ROUTE, routeId: 'unhealthy', health: 'degraded' as const },
                LOCAL_ROUTE,
            ],
        });

        if (resolution.status !== 'ready') {
            throw new Error('Expected the valid local route to be selected');
        }
        expect(resolution.selectedRouteId).toBe(LOCAL_ROUTE.routeId);
        expect(resolution.rejected).toEqual([
            { routeId: 'missing-capability', reasons: ['missing-capability'] },
            { routeId: 'wrong-trust', reasons: ['trust-policy', 'cost-policy'] },
            { routeId: 'wrong-cost', reasons: ['cost-policy'] },
            { routeId: 'no-platform', reasons: ['platform-unavailable'] },
            { routeId: 'not-installed', reasons: ['model-not-installed'] },
            { routeId: 'unhealthy', reasons: ['unhealthy'] },
        ]);
    });

    it('admits a compiled future adapter through the same provider-neutral contract', () => {
        const futureRoute = {
            ...REMOTE_ROUTE,
            routeId: 'studio.future:mix-model-v1',
            providerId: 'studio.future',
            modelId: 'mix-model-v1',
            protocolFamily: 'future-messages-v1',
            cost: 'free' as const,
        };

        expect(
            resolveModelRoute({
                requestedRoute: futureRoute.routeId,
                requirements: { ...REQUIREMENTS, costPolicy: 'allow-free-remote' },
                candidates: [futureRoute],
            })
        ).toMatchObject({
            status: 'ready',
            requestedRoute: futureRoute.routeId,
            selectedRouteId: futureRoute.routeId,
            routes: [futureRoute],
        });
    });
});
