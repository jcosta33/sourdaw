import { modulationRoutes, type ModulationRoute } from './types';

export function getAllModulationRoutes(): ModulationRoute[] {
    return [...modulationRoutes.values()];
}
