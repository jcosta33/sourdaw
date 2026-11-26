/** The first Yeast device in a track's device list, or `undefined` when the track holds none. */
export function findYeastDevice<Device extends { readonly type: string }>(
    devices: readonly Device[]
): Device | undefined {
    return devices.find((device) => device.type === 'yeast');
}
