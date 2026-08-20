const WITHHELD_DEVICE_TYPES = new Set(['grand-boule']);

export function isDeviceReleaseAdmitted(deviceType: string): boolean {
    return !WITHHELD_DEVICE_TYPES.has(deviceType);
}
