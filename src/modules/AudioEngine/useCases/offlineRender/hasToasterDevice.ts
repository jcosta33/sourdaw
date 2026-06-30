type HasToasterDeviceInput = {
    devices: readonly { type: string }[];
};

export function hasToasterDevice(track: HasToasterDeviceInput): boolean {
    return track.devices.some((device) => device.type === 'toaster');
}
