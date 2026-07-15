export function isDrumDevice(deviceType: string): boolean {
    return (
        deviceType === 'builtin-drum-kit' || deviceType === 'drum-kit' || deviceType.startsWith('builtin-drum-machine')
    );
}
