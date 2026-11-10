import { projectLifecycleRegistry } from '../projectLifecycleRegistry';

import { type HydratableProjectData } from './isHydratableProjectData';

/**
 * Hydrate every module's project-scoped state from a loaded project file,
 * through the participants the composition root registered, in their
 * registered order. Each owner clears its state when the file carries none.
 */
export function hydrateModuleStoresFromProjectData(data: HydratableProjectData): void {
    for (const participant of projectLifecycleRegistry.read('hydrateModuleStoresFromProjectData')) {
        participant.hydrateFromProjectData?.(data);
    }
}
