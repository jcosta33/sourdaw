/** Fresh committed membership supplied by the composition root; no project snapshot is retained. */
export type LevainDeviceStateProjectAccess = {
    hasDevice: (ownerId: string, deviceId: string) => boolean;
    subscribe: (listener: () => void) => () => void;
};

let provider: LevainDeviceStateProjectAccess | null = null;

export function setLevainDeviceStateProjectAccess(next: LevainDeviceStateProjectAccess | null): void {
    provider = next;
}

export function getLevainDeviceStateProjectAccess(): LevainDeviceStateProjectAccess | null {
    return provider;
}
