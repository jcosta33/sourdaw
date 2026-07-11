import { cloudSession } from './cloudSession';

/** Register a controller for an in-flight cloud stream. Returns the controller. */
export function registerCloudStreamController(controller: AbortController): AbortController {
    return cloudSession.register_controller(controller);
}
