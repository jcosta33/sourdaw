import type { Device, Track } from '#/modules/Arrangement/stores';

/**
 * A hosted device is the only device kind the engine sounds live notes on
 * from the renderer's admission today; carried built-ins join when the TS
 * admission for native built-in bodies lands (#3893).
 */
export function resolveNativeNoteSink(
    instrumentTrack: Track,
    isCarried: (trackId: string, deviceId: string) => boolean
): Device | null {
    const carriedDevice = instrumentTrack.devices.find(
        (device) => device.externalInstanceId !== undefined && isCarried(instrumentTrack.id, device.id)
    );
    return carriedDevice ?? null;
}
