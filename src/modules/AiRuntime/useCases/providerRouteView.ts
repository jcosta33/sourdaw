import { type AgentDataRetention } from '../models/AgentDataPolicy';
import { type AgentRun, type AgentRunBudgetEstimateMethod } from '../models/AgentRun';
import { type ModelProviderUsageProvenance } from '../models/ModelProviderProtocol';

export type ProviderRouteViewInput = {
    requestedRoute: 'browser-local' | 'native-local' | 'remote';
    actualRoute: 'browser-local' | 'native-local' | 'remote' | null;
    availability: { status: 'available' | 'unavailable'; reason: string | null };
    capability: { role: string; fidelity: string };
    fallback: {
        attempted: boolean;
        reason: string | null;
        attempts: Array<{
            provider: string;
            model: string | null;
            correlationId: string | null;
            status: string;
            reason: string | null;
        }>;
    };
    dataPolicy: { categories: string[]; retention: AgentDataRetention };
    cache: { status: 'used' | 'not-used' | 'unavailable'; provenance: ModelProviderUsageProvenance };
    usage: {
        provenance: ModelProviderUsageProvenance;
        priceProvenance: ModelProviderUsageProvenance;
        estimateMethod: AgentRunBudgetEstimateMethod | null;
    };
};

export type ProviderRouteView = Readonly<ProviderRouteViewInput>;

function buildProviderRouteView(input: ProviderRouteViewInput): ProviderRouteView {
    return structuredClone(input);
}

const UNKNOWN_RETENTION: AgentDataRetention = {
    applicationState: 'unknown',
    abuseMonitoring: 'unknown',
    promptCache: 'unknown',
    safetyLegalException: 'unknown',
    unknown: 'unknown',
};

function getCacheRouteView(usage: AgentRun['providerUsage'][number] | undefined) {
    if (usage === undefined) {
        return { status: 'unavailable' as const, provenance: 'unavailable' as const };
    }
    return {
        status: (usage.cachedInputTokens ?? 0) > 0 ? ('used' as const) : ('not-used' as const),
        provenance: usage.provenance,
    };
}

function getEstimateMethodRouteView(
    run: AgentRun,
    usage: AgentRun['providerUsage'][number] | undefined
): AgentRunBudgetEstimateMethod | null {
    if (usage?.correlationId === undefined) {
        return null;
    }
    return run.budgetAttempts.find((attempt) => attempt.attemptId === usage.correlationId)?.estimateMethod ?? null;
}

export function getProviderRouteView(run: AgentRun): ProviderRouteView {
    const usage = run.providerUsage.at(-1);
    let actualRoute: ProviderRouteViewInput['actualRoute'] = null;
    if (usage?.executor === 'cloud') {
        actualRoute = 'remote';
    } else if (usage?.executor === 'native') {
        actualRoute = 'native-local';
    } else if (usage?.executor === 'webllm') {
        actualRoute = 'browser-local';
    }
    let requestedRoute: ProviderRouteViewInput['requestedRoute'] = 'browser-local';
    if (run.modelRoute.requestedRoute === 'cloud') {
        requestedRoute = 'remote';
    } else if (run.modelRoute.requestedRoute === 'native') {
        requestedRoute = 'native-local';
    }

    const availability = (() => {
        if (usage === undefined) {
            return { status: 'unavailable' as const, reason: 'no-provider-attempt' };
        }
        if (usage.status !== 'complete') {
            return {
                status: 'unavailable' as const,
                reason: usage.fallbackReason ?? usage.status ?? 'provider-unavailable',
            };
        }
        return { status: 'available' as const, reason: null };
    })();
    return buildProviderRouteView({
        requestedRoute,
        actualRoute,
        availability,
        capability: {
            role: run.mode === 'explain' ? 'text' : 'tool-planning',
            fidelity: usage?.model ?? 'unavailable',
        },
        fallback: {
            attempted: run.providerUsage.some(
                (attempt) => attempt.fallbackReason !== null && attempt.fallbackReason !== undefined
            ),
            reason: [...run.providerUsage].reverse().find((attempt) => attempt.fallbackReason)?.fallbackReason ?? null,
            attempts: run.providerUsage.map((attempt) => ({
                provider: attempt.provider,
                model: attempt.model,
                correlationId: attempt.correlationId ?? null,
                status: attempt.status ?? 'unavailable',
                reason: attempt.fallbackReason ?? null,
            })),
        },
        dataPolicy: {
            categories: usage?.disclosure?.categories ?? [],
            retention: usage?.disclosure?.retention ?? UNKNOWN_RETENTION,
        },
        cache: getCacheRouteView(usage),
        usage: {
            provenance: usage?.provenance ?? 'unavailable',
            priceProvenance: 'unavailable',
            estimateMethod: getEstimateMethodRouteView(run, usage),
        },
    });
}
