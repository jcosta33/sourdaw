import { AGENT_DATA_CATEGORIES, type AgentDataCategory, type AgentDataRetention } from '../models/AgentDataPolicy';
import { type AgentRun, type AgentRunProviderUsage } from '../models/AgentRun';

import { agentRunLifecycle } from './agentRunLifecycle';
import { createRouteCandidate } from './llmOrchestration/backendResolution/createRouteCandidate';
import { type ModelRouteCandidate, type ModelRouteRejectionReason, resolveModelRoute } from './resolveModelRoute';

export type ProviderRouteView = {
    runId: string;
    requested: { route: AgentRun['modelRoute']['requestedRoute']; locality: 'browser-local' | 'remote' | 'unknown' };
    actual: {
        routeId: string | null;
        executor: 'webllm' | 'cloud' | 'legacy-unknown' | null;
        locality: 'browser-local' | 'remote' | 'unknown';
        provider: string | null;
        model: string | null;
    };
    platform: { available: boolean; evidence: string | null; unavailableReason: ModelRouteRejectionReason | null };
    options: readonly { routeId: string; admitted: boolean; reasons: readonly ModelRouteRejectionReason[] }[];
    capability: { operations: readonly string[]; modalities: readonly string[]; streaming: boolean } | null;
    fidelity: 'release-owned-local' | 'configured-remote' | null;
    fallback: { attempted: boolean; reasons: readonly string[] };
    fallbackPolicy: 'local-only' | 'hosted-then-local';
    dataDisclosure: { categories: readonly AgentDataCategory[]; retention: AgentDataRetention } | null;
    usage: {
        provenance: 'provider-reported' | 'versioned-estimate' | 'unavailable';
        inputTokens: number;
        outputTokens: number;
        cachedInputTokens: number;
        attempts: number;
    };
    cost: readonly {
        category: string;
        reserved: number;
        actual: number;
        provenance: 'provider-reported' | 'versioned-estimate' | 'unavailable';
        final: boolean;
    }[];
};

type ProviderRouteOption = ProviderRouteView['options'][number];

type GetProviderRouteViewInput = {
    runId: string;
    candidates?: readonly ModelRouteCandidate[];
};

const KNOWN_AGENT_DATA_CATEGORIES = new Set<string>(AGENT_DATA_CATEGORIES);
const PROVENANCE_RANK: Record<AgentRunProviderUsage['provenance'], number> = {
    unavailable: 0,
    'versioned-estimate': 1,
    'provider-reported': 2,
};
const RELAXED_ROUTE_REQUIREMENTS = {
    operation: 'text' as const,
    modality: 'text' as const,
    streaming: false,
    allowedTrust: ['release-owned-local', 'configured-remote'] as const,
    costPolicy: 'allow-paid-remote' as const,
    requireInstalledModel: false,
};

function isAgentDataCategory(category: string): category is AgentDataCategory {
    return KNOWN_AGENT_DATA_CATEGORIES.has(category);
}

function getRouteLocality(route: string): 'browser-local' | 'remote' | 'unknown' {
    if (route === 'webllm') {
        return 'browser-local';
    }
    if (route === 'cloud') {
        return 'remote';
    }
    return 'unknown';
}

function hasUnavailableStatus(usage: AgentRunProviderUsage): boolean {
    return usage.status === 'unavailable';
}

function getDefaultCandidates(): ModelRouteCandidate[] {
    return (['webllm', 'cloud'] as const).map(createRouteCandidate);
}

function getActualUsage(providerUsage: readonly AgentRunProviderUsage[]): AgentRunProviderUsage | null {
    for (let index = providerUsage.length - 1; index >= 0; index -= 1) {
        const usage = providerUsage[index]!;
        if (!hasUnavailableStatus(usage)) {
            return usage;
        }
    }
    return null;
}

function getActualRouteProjection(providerUsage: readonly AgentRunProviderUsage[]): ProviderRouteView['actual'] {
    const usage = getActualUsage(providerUsage);
    if (usage === null) {
        return { routeId: null, executor: null, locality: 'unknown', provider: null, model: null };
    }
    const executor = usage.executor ?? null;
    return {
        routeId: usage.routeId ?? null,
        executor,
        locality: executor === null ? 'unknown' : getRouteLocality(executor),
        provider: usage.provider,
        model: usage.model,
    };
}

/** Every route the resolver judged, admitted or not, in the order the caller offered the candidates. */
function getRouteOptions(
    resolution: ReturnType<typeof resolveModelRoute>,
    candidates: readonly ModelRouteCandidate[]
): ProviderRouteView['options'] {
    const options: ProviderRouteOption[] = [
        ...resolution.routes.map((route) => ({ routeId: route.routeId, admitted: true, reasons: [] })),
        ...resolution.rejected.map((rejection) => ({
            routeId: rejection.routeId,
            admitted: false,
            reasons: rejection.reasons,
        })),
    ];
    const rankByRouteId = new Map(candidates.map((candidate, index) => [candidate.routeId, index]));
    // A rejected id no candidate carries is an unknown requested route; it sorts after every known one.
    const rank = (option: ProviderRouteOption): number => rankByRouteId.get(option.routeId) ?? candidates.length;
    return options.toSorted((left, right) => rank(left) - rank(right));
}

function getRoutePlatformProjection(input: {
    requestedRoute: string;
    candidates: readonly ModelRouteCandidate[];
    dataPolicy: 'local-only' | 'remote-allowed';
}): Pick<ProviderRouteView, 'platform' | 'options' | 'capability' | 'fidelity'> {
    const resolution = resolveModelRoute({
        requestedRoute: input.requestedRoute,
        requirements: { ...RELAXED_ROUTE_REQUIREMENTS, dataPolicy: input.dataPolicy },
        candidates: input.candidates,
    });
    const options = getRouteOptions(resolution, input.candidates);
    if (resolution.status === 'ready') {
        const selected =
            resolution.routes.find((route) => route.routeId === resolution.selectedRouteId) ?? resolution.routes[0]!;
        return {
            platform: { available: true, evidence: selected.platform.evidence, unavailableReason: null },
            options,
            capability: {
                operations: selected.capabilities.operations,
                modalities: selected.capabilities.modalities,
                streaming: selected.capabilities.streaming,
            },
            fidelity: selected.trust,
        };
    }
    const requestedRejection = resolution.rejected.find((rejection) => rejection.routeId === input.requestedRoute);
    const unavailableReason = requestedRejection?.reasons[0] ?? resolution.rejected[0]?.reasons[0] ?? null;
    return {
        platform: { available: false, evidence: null, unavailableReason },
        options,
        capability: null,
        fidelity: null,
    };
}

function getFallbackProjection(
    requestedRoute: string,
    providerUsage: readonly AgentRunProviderUsage[]
): ProviderRouteView['fallback'] {
    const reasons = providerUsage
        .map((usage) => usage.fallbackReason)
        .filter((reason): reason is string => reason !== null && reason !== undefined);
    const counted = providerUsage.filter((usage) => !hasUnavailableStatus(usage) && usage.executor !== undefined);
    const executors = new Set(counted.map((usage) => usage.executor));
    const requestedExecutor = requestedRoute === 'auto' ? null : requestedRoute;
    const attempted =
        requestedExecutor === null ? executors.size > 1 : counted.some((usage) => usage.executor !== requestedExecutor);
    return { attempted, reasons };
}

function getDataDisclosureProjection(
    providerUsage: readonly AgentRunProviderUsage[]
): ProviderRouteView['dataDisclosure'] {
    for (let index = providerUsage.length - 1; index >= 0; index -= 1) {
        const disclosure = providerUsage[index]!.disclosure;
        if (disclosure !== undefined) {
            return {
                categories: disclosure.categories.filter(isAgentDataCategory),
                retention: disclosure.retention,
            };
        }
    }
    return null;
}

function getUsageProjection(providerUsage: readonly AgentRunProviderUsage[]): ProviderRouteView['usage'] {
    const counted = providerUsage.filter((usage) => !hasUnavailableStatus(usage));
    if (counted.length === 0) {
        return { provenance: 'unavailable', inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, attempts: 0 };
    }
    let inputTokens = 0;
    let outputTokens = 0;
    let cachedInputTokens = 0;
    let provenance = counted[0]!.provenance;
    for (const usage of counted) {
        inputTokens += usage.inputTokens ?? 0;
        outputTokens += usage.outputTokens ?? 0;
        cachedInputTokens += usage.cachedInputTokens ?? 0;
        if (PROVENANCE_RANK[usage.provenance] < PROVENANCE_RANK[provenance]) {
            provenance = usage.provenance;
        }
    }
    return { provenance, inputTokens, outputTokens, cachedInputTokens, attempts: counted.length };
}

function getCostProjection(run: AgentRun): ProviderRouteView['cost'] {
    return run.budgetAttempts.map((attempt) => ({
        category: attempt.category,
        reserved: attempt.reserved,
        actual: attempt.actual,
        provenance: attempt.provenance,
        final: attempt.final,
    }));
}

export function getProviderRouteView(input: GetProviderRouteViewInput): ProviderRouteView | null {
    const run = agentRunLifecycle.get(input.runId);
    if (run === null) {
        return null;
    }
    const candidates = input.candidates ?? getDefaultCandidates();
    /**
     * The requested route carries the run's data policy; disclosures are attempt evidence
     * that arrives only after admission. Only an explicit hosted request widens the chain
     * past the browser — an automatic or WebLLM preference stays local even when no local
     * route is admitted.
     */
    const hostedRequested = run.modelRoute.requestedRoute === 'cloud';
    const { platform, options, capability, fidelity } = getRoutePlatformProjection({
        requestedRoute: run.modelRoute.requestedRoute,
        candidates,
        dataPolicy: hostedRequested ? 'remote-allowed' : 'local-only',
    });
    return {
        runId: run.runId,
        requested: {
            route: run.modelRoute.requestedRoute,
            locality: getRouteLocality(run.modelRoute.requestedRoute),
        },
        actual: getActualRouteProjection(run.providerUsage),
        platform,
        options,
        capability,
        fidelity,
        fallback: getFallbackProjection(run.modelRoute.requestedRoute, run.providerUsage),
        fallbackPolicy: hostedRequested ? 'hosted-then-local' : 'local-only',
        dataDisclosure: getDataDisclosureProjection(run.providerUsage),
        usage: getUsageProjection(run.providerUsage),
        cost: getCostProjection(run),
    };
}
