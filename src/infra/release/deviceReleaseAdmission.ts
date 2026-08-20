const WITHHELD_DEVICE_TYPES = new Set(['grand-boule']);

export function isDeviceReleaseAdmitted(deviceType: string): boolean {
    return !WITHHELD_DEVICE_TYPES.has(deviceType);
}

export function findWithheldDeviceType(devices: ReadonlyArray<{ type: string }>): string | undefined {
    return devices.find(({ type }) => !isDeviceReleaseAdmitted(type))?.type;
}

export function assertReleaseAdmittedDevices(
    tracks: ReadonlyArray<{ devices: ReadonlyArray<{ type: string }> }>
): void {
    const withheldType = findWithheldDeviceType(tracks.flatMap(({ devices }) => devices));
    if (withheldType !== undefined) {
        throw new Error(`Device type "${withheldType}" is withheld from release.`);
    }
}
