import { modulationRoutes } from './types';

/**
 * Set the modulation amount for a route (immutable via Store).
 */
export function setModulationAmount(routeId: string, amount: number): void {
    const route = modulationRoutes.get(routeId);
    if (!route) {
        return;
    }
    modulationRoutes.set(routeId, {
        ...route,
        amount: Math.max(-1, Math.min(1, amount)),
    });
}
