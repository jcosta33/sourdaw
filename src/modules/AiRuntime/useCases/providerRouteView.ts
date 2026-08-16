import { type AgentDataRetention } from '../models/AgentDataPolicy';
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

export function buildProviderRouteView(input: ProviderRouteViewInput): ProviderRouteView {
    return structuredClone(input);
}
