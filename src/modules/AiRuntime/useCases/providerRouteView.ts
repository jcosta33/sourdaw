import { type AgentDataRetention } from '../models/AgentDataPolicy';
import { type AgentRun } from '../models/AgentRun';
import { type ModelProviderUsageProvenance } from '../models/ModelProviderProtocol';

export type ProviderRouteViewInput = {
    requestedRoute: 'browser-local' | 'native-local' | 'remote';
    actualRoute: 'browser-local' | 'native-local' | 'remote' | null;
    availability: { status: 'available' | 'unavailable'; reason: string | null };
    capability: { role: string; fidelity: string };
    fallback: { attempted: boolean; reason: string | null };
    dataPolicy: { categories: string[]; retention: AgentDataRetention };
    cache: { status: 'used' | 'not-used' | 'unavailable'; provenance: ModelProviderUsageProvenance };
    usage: { provenance: ModelProviderUsageProvenance; priceProvenance: ModelProviderUsageProvenance };
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
        if (usage.status === 'unavailable') {
            return { status: 'unavailable' as const, reason: usage.fallbackReason ?? 'provider-unavailable' };
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
            attempted: usage?.fallbackReason !== null && usage?.fallbackReason !== undefined,
            reason: usage?.fallbackReason ?? null,
        },
        dataPolicy: {
            categories: usage?.disclosure?.categories ?? [],
            retention: usage?.disclosure?.retention ?? UNKNOWN_RETENTION,
        },
        cache: getCacheRouteView(usage),
        usage: { provenance: usage?.provenance ?? 'unavailable', priceProvenance: 'unavailable' },
    });
}
