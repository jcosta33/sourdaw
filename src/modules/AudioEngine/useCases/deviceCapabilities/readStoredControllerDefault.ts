import { resolveStoredControllerHosting } from '../../models/StoredControllerHostingByDeviceType';

/** The value a stored controller returns to on a device type when no row is in force, or undefined when it has none. */
export function readStoredControllerDefault(deviceType: string, controller: number): number | undefined {
    return resolveStoredControllerHosting(deviceType)?.controllerDefaults.get(controller);
}
