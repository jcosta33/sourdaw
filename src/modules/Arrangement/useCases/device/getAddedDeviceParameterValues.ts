import { composeAddedDeviceParameterValues } from './composeAddedDeviceParameterValues';
import { findAddedDevicePlugin } from './findAddedDevicePlugin';

/**
 * The parameter values a device of this type holds the moment an `addDevice` command places it, or
 * null when no platform plugin declares the type. A write of exactly one of these values to the
 * device that command placed changes nothing.
 */
export function getAddedDeviceParameterValues(deviceType: string): Readonly<Record<string, number>> | null {
    const plugin = findAddedDevicePlugin(deviceType);
    return plugin === undefined ? null : composeAddedDeviceParameterValues(plugin);
}
