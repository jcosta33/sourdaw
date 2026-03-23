import { modulationRoutes } from './types';

export function deleteModulationRoute(routeId: string): void {
    modulationRoutes.delete(routeId);
}
