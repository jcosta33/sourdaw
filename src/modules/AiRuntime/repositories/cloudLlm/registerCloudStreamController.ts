import { activeCloudStreamControllers } from './activeCloudStreamControllers';

/** Register a controller for an in-flight cloud stream. Returns the controller. */
export function registerCloudStreamController(controller: AbortController): AbortController {
    activeCloudStreamControllers.add(controller);
    return controller;
}
