import { cloudSession } from './cloudSession';

/** Unregister a controller once its stream has settled. */
export function unregisterCloudStreamController(controller: AbortController): void {
    cloudSession.unregister_controller(controller);
}
