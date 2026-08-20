const WITHHELD_DEVICE_TYPES = new Set(['grand-boule']);

export function isDeviceReleaseAdmitted(deviceType: string): boolean {
    return !WITHHELD_DEVICE_TYPES.has(deviceType);
}

export function assertReleaseAdmittedDevices(
    tracks: ReadonlyArray<{ devices: ReadonlyArray<{ type: string }> }>
): void {
    const withheld = tracks.flatMap(({ devices }) => devices).find(({ type }) => !isDeviceReleaseAdmitted(type));
    if (withheld !== undefined) {
        throw new Error(`Device type "${withheld.type}" is withheld from release.`);
    }
}
