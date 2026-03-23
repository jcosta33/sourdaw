import { modulationSources, modulationRoutes } from './types';

export function deleteModulationSource(sourceId: string): void {
    modulationSources.delete(sourceId);
    // Remove routes using this source
    for (const route of modulationRoutes.values()) {
        if (route.sourceId === sourceId) {
            modulationRoutes.delete(route.id);
        }
    }
}
