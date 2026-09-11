import { type ReactElement, type ReactNode } from 'react';

import { Stack } from '#/components/layout';

/** The provider-route projection fields this section renders, as a leaf-owned structural shape. */
type AgentRouteView = {
    requested: { route: string; locality: string };
    actual: { executor: string | null; locality: string; provider: string | null; model: string | null };
    platform: { available: boolean; unavailableReason: string | null };
    capability: { operations: readonly string[]; modalities: readonly string[]; streaming: boolean } | null;
    fidelity: string | null;
    fallback: { attempted: boolean; reasons: readonly string[] };
    dataDisclosure: { categories: readonly string[]; retention: Readonly<Record<string, string>> } | null;
    usage: { provenance: string; attempts: number };
    cost: readonly { category: string; reserved: number; actual: number; provenance: string }[];
};

type AgentRouteSectionProps = {
    route: AgentRouteView | null;
};

function formatPlatform(platform: AgentRouteView['platform']): string {
    if (platform.available) {
        return 'available';
    }
    return `unavailable: ${platform.unavailableReason ?? 'unknown'}`;
}

function formatCapability(capability: AgentRouteView['capability']): string {
    if (capability === null) {
        return 'none';
    }
    const operations = capability.operations.join(', ');
    const modalities = capability.modalities.join(', ');
    return `${operations} / ${modalities} / streaming ${String(capability.streaming)}`;
}

function formatDisclosure(disclosure: AgentRouteView['dataDisclosure']): string {
    if (disclosure === null) {
        return 'none';
    }
    const retention = Object.entries(disclosure.retention)
        .map(([name, value]) => `${name} ${value}`)
        .join(', ');
    return `${disclosure.categories.join(', ')} — retention ${retention}`;
}

function formatCost(cost: AgentRouteView['cost']): string {
    if (cost.length === 0) {
        return 'none';
    }
    return cost
        .map((attempt) => `${attempt.category} ${attempt.actual}/${attempt.reserved} ${attempt.provenance}`)
        .join('; ');
}

function renderTerm(term: string, value: ReactNode): ReactElement {
    return (
        <>
            <dt className="text-muted-foreground">{term}</dt>
            <dd className="text-foreground">{value}</dd>
        </>
    );
}

export const AgentRouteSection = ({ route }: AgentRouteSectionProps): ReactElement => {
    if (route === null) {
        return (
            <Stack as="section" gap={1} aria-label="Provider route">
                <h4 className="text-xs font-semibold text-foreground">Provider route</h4>
                <p className="text-xs text-muted-foreground">Route not resolved</p>
            </Stack>
        );
    }

    return (
        <Stack as="section" gap={1} aria-label="Provider route">
            <h4 className="text-xs font-semibold text-foreground">Provider route</h4>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                {renderTerm('Requested route', `${route.requested.route} (${route.requested.locality})`)}
                {renderTerm(
                    'Actual route',
                    `${route.actual.executor ?? 'none'} / ${route.actual.provider ?? 'none'} / ${route.actual.model ?? 'none'} (${route.actual.locality})`
                )}
                {renderTerm('Platform', formatPlatform(route.platform))}
                {renderTerm('Capability', formatCapability(route.capability))}
                {renderTerm('Fidelity', route.fidelity ?? 'none')}
                {renderTerm(
                    'Fallback',
                    route.fallback.attempted ? `attempted: ${route.fallback.reasons.join(', ')}` : 'not attempted'
                )}
                {renderTerm('Data disclosure', formatDisclosure(route.dataDisclosure))}
                {renderTerm('Usage provenance', `${route.usage.provenance} over ${route.usage.attempts} attempts`)}
                {renderTerm('Price provenance', formatCost(route.cost))}
            </dl>
        </Stack>
    );
};
