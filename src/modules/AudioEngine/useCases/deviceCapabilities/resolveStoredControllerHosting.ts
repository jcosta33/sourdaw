import { resolveStoredControllerHosting as resolveByDeviceType } from '../../models/StoredControllerHostingByDeviceType';

/**
 * How a device type takes stored clip controller moves (through which controls,
 * as pedal positions or raw controllers, returning to which defaults), or null
 * for a device that ignores them.
 */
export function resolveStoredControllerHosting(deviceType: string): ReturnType<typeof resolveByDeviceType> {
    return resolveByDeviceType(deviceType);
}
