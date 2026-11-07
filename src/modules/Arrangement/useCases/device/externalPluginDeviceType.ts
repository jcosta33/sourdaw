/** The stored device type of a third-party plugin device, created by `addExternalDevice`. */
export const EXTERNAL_PLUGIN_DEVICE_TYPE = 'external-plugin';

/** Whether a stored device type is a third-party plugin device, which names no builtin descriptor. */
export function isExternalPluginDeviceType(deviceType: string | undefined): boolean {
    return deviceType === EXTERNAL_PLUGIN_DEVICE_TYPE;
}
