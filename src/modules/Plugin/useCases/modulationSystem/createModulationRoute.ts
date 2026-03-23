import { modulationSources, modulationRoutes, type ModulationTarget, type ModulationRoute } from './types';

export function createModulationRoute(
    sourceId: string,
    target: ModulationTarget,
    amount = 0.5,
    bipolar = false
): ModulationRoute | null {
    if (!modulationSources.has(sourceId)) {
        return null;
    }

    const route: ModulationRoute = {
        id: `mod-route-${crypto.randomUUID().slice(0, 8)}`,
        sourceId,
        target,
        amount: Math.max(-1, Math.min(1, amount)),
        bipolar,
    };
    modulationRoutes.set(route.id, route);
    return route;
}
