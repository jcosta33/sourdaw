import { type AgentDataRetention } from '../models/AgentDataPolicy';
import { type AgentRun } from '../models/AgentRun';
import { type ModelProviderUsageProvenance } from '../models/ModelProviderProtocol';

export type ProviderRouteViewInput = {
    requestedRoute: 'browser-local' | 'native-local' | 'remote';
    actualRoute: 'browser-local' | 'native-local' | 'remote';
    availability: { status: 'available' | 'unavailable'; reason: string | null };
    capability: { role: string; fidelity: string };
    fallback: { attempted: boolean; reason: string | null };
    dataPolicy: { categories: string[]; retention: AgentDataRetention };
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

export function getProviderRouteView(run: AgentRun): ProviderRouteView {
    const usage = run.providerUsage.at(-1);
    let actualRoute: ProviderRouteViewInput['actualRoute'] = 'browser-local';
    if (usage?.executor === 'cloud') {
        actualRoute = 'remote';
    } else if (usage?.executor === 'native') {
        actualRoute = 'native-local';
    }
    let requestedRoute: ProviderRouteViewInput['requestedRoute'] = 'browser-local';
    if (run.modelRoute.requestedRoute === 'cloud') {
        requestedRoute = 'remote';
    } else if (run.modelRoute.requestedRoute === 'native') {
        requestedRoute = 'native-local';
    }
    return {
        requestedRoute,
        actualRoute,
        availability: {
            status: usage?.status === 'unavailable' ? 'unavailable' : 'available',
            reason: usage?.status === 'unavailable' ? (usage.fallbackReason ?? 'provider-unavailable') : null,
        },
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
        usage: { provenance: usage?.provenance ?? 'unavailable', priceProvenance: 'unavailable' },
    };
}
