import { activeCloudStreamControllers } from './activeCloudStreamControllers';

/** Unregister a controller once its stream has settled. */
export function unregisterCloudStreamController(controller: AbortController): void {
    activeCloudStreamControllers.delete(controller);
}
