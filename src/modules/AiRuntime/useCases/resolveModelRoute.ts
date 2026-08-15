import { type RunnableAiBackend } from '../models/LlmOrchestrationTypes';
import { type ModelProviderModality, type ModelProviderOperation } from '../models/ModelProviderProtocol';

type ModelRouteTrust = 'release-owned-local' | 'configured-remote';
type ModelRouteDataClass = 'local-private' | 'remote-export';
type ModelRouteCost = 'local' | 'free' | 'paid';
type ModelRouteHealth = 'healthy' | 'degraded' | 'unavailable';
type ModelRouteCostPolicy = 'local-only' | 'allow-free-remote' | 'allow-paid-remote';

type ModelRouteCandidate = {
    routeId: string;
    executor: RunnableAiBackend;
    providerId: string;
    modelId: string;
    protocolFamily: string;
    capabilities: {
        operations: readonly ModelProviderOperation[];
        modalities: readonly ModelProviderModality[];
        streaming: boolean;
    };
    trust: ModelRouteTrust;
    dataClass: ModelRouteDataClass;
    cost: ModelRouteCost;
    platform: {
        available: boolean;
        evidence: string | null;
    };
    modelInstalled: boolean;
    health: ModelRouteHealth;
};

type ModelRouteRequirements = {
    operation: ModelProviderOperation;
    modality: ModelProviderModality;
    streaming: boolean;
    allowedTrust: readonly ModelRouteTrust[];
    dataPolicy: 'local-only' | 'remote-allowed';
    costPolicy: ModelRouteCostPolicy;
    requireInstalledModel: boolean;
};

type ModelRouteRejectionReason =
    | 'unknown-route'
    | 'duplicate-route'
    | 'missing-capability'
    | 'trust-policy'
    | 'data-policy'
    | 'cost-policy'
    | 'platform-unavailable'
    | 'model-not-installed'
    | 'unhealthy';

type ModelRouteRejection = {
    routeId: string;
    reasons: ModelRouteRejectionReason[];
};

type ResolveModelRouteInput = {
    requestedRoute: string;
    requirements: ModelRouteRequirements;
    candidates: readonly ModelRouteCandidate[];
};

type ModelRouteResolution =
    | {
          status: 'ready';
          requestedRoute: string;
          selectedRouteId: string;
          routes: ModelRouteCandidate[];
          rejected: ModelRouteRejection[];
      }
    | {
          status: 'unavailable';
          requestedRoute: string;
          routes: [];
          rejected: ModelRouteRejection[];
      };

function isCostAllowed(cost: ModelRouteCost, policy: ModelRouteCostPolicy): boolean {
    if (cost === 'local') {
        return true;
    }
    if (cost === 'free') {
        return policy !== 'local-only';
    }
    return policy === 'allow-paid-remote';
}

function getRejectionReasons(
    candidate: ModelRouteCandidate,
    requirements: ModelRouteRequirements,
    duplicateRouteIds: ReadonlySet<string>
): ModelRouteRejectionReason[] {
    const reasons: ModelRouteRejectionReason[] = [];
    if (duplicateRouteIds.has(candidate.routeId)) {
        reasons.push('duplicate-route');
    }
    if (
        !candidate.capabilities.operations.includes(requirements.operation) ||
        !candidate.capabilities.modalities.includes(requirements.modality) ||
        (requirements.streaming && !candidate.capabilities.streaming)
    ) {
        reasons.push('missing-capability');
    }
    if (!requirements.allowedTrust.includes(candidate.trust)) {
        reasons.push('trust-policy');
    }
    if (requirements.dataPolicy === 'local-only' && candidate.dataClass === 'remote-export') {
        reasons.push('data-policy');
    }
    if (!isCostAllowed(candidate.cost, requirements.costPolicy)) {
        reasons.push('cost-policy');
    }
    if (!candidate.platform.available || candidate.platform.evidence === null) {
        reasons.push('platform-unavailable');
    }
    if (requirements.requireInstalledModel && !candidate.modelInstalled) {
        reasons.push('model-not-installed');
    }
    if (candidate.health !== 'healthy') {
        reasons.push('unhealthy');
    }
    return reasons;
}

export function resolveModelRoute(input: ResolveModelRouteInput): ModelRouteResolution {
    const consideredCandidates =
        input.requestedRoute === 'auto'
            ? input.candidates
            : input.candidates.filter((candidate) => candidate.routeId === input.requestedRoute);
    const routes: ModelRouteCandidate[] = [];
    const rejected: ModelRouteRejection[] = [];
    const routeIdCounts = new Map<string, number>();
    for (const candidate of consideredCandidates) {
        routeIdCounts.set(candidate.routeId, (routeIdCounts.get(candidate.routeId) ?? 0) + 1);
    }
    const duplicateRouteIds = new Set([...routeIdCounts].filter(([, count]) => count > 1).map(([routeId]) => routeId));
    const rejectedRouteIds = new Set<string>();

    if (input.requestedRoute !== 'auto' && consideredCandidates.length === 0) {
        rejected.push({ routeId: input.requestedRoute, reasons: ['unknown-route'] });
    }

    for (const candidate of consideredCandidates) {
        const reasons = getRejectionReasons(candidate, input.requirements, duplicateRouteIds);
        if (reasons.length === 0) {
            routes.push(structuredClone(candidate));
        } else if (!rejectedRouteIds.has(candidate.routeId)) {
            rejected.push({ routeId: candidate.routeId, reasons });
            rejectedRouteIds.add(candidate.routeId);
        }
    }

    const selected = routes[0];
    if (selected === undefined) {
        return {
            status: 'unavailable',
            requestedRoute: input.requestedRoute,
            routes: [],
            rejected,
        };
    }
    return {
        status: 'ready',
        requestedRoute: input.requestedRoute,
        selectedRouteId: selected.routeId,
        routes,
        rejected,
    };
}
