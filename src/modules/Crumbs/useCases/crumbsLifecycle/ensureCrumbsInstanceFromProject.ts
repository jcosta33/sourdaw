import { crumbsStore, defaultCrumbsState } from '../../stores/crumbsStore';
import { hydrateCrumbsStateFromProject } from '../hydrateCrumbsStateFromProject';

/**
 * Create a device's session entry, seeded from project truth when there is any.
 *
 * The hydrating replacement for `ensureInstance`. That mutator seeds the module
 * default unconditionally, so whichever of the panel and the engine build reached
 * it first won — and after a reload both of them reached it with an empty store, so
 * the default always won and the saved sample was overwritten before anything could
 * read it back.
 *
 * Idempotent, like `ensureInstance`: a device that already has a session entry keeps
 * it, so a later caller cannot roll a live edit back to the last committed chunk.
 */
export function ensureCrumbsInstanceFromProject(deviceId: string): void {
    const instances = crumbsStore.value ?? {};
    if (instances[deviceId]) {
        return;
    }

    crumbsStore.set({
        ...instances,
        [deviceId]: hydrateCrumbsStateFromProject(deviceId) ?? { ...defaultCrumbsState },
    });
}
