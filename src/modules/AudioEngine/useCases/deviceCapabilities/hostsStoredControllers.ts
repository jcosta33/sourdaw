import { resolveStoredControllerHosting } from '../../models/StoredControllerHostingByDeviceType';

/** True for a device type that takes the controller moves stored clip playback posts. */
export function hostsStoredControllers(deviceType: string): boolean {
    return resolveStoredControllerHosting(deviceType) !== null;
}
