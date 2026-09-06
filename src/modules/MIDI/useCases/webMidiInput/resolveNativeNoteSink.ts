import type { Device, Track } from '#/modules/Arrangement/stores';

export type NativeNoteSinkDependencies = Readonly<{
    /** Whether the engine holds a body for this device this session — proof it has something to sound. */
    isDeviceCarriedByNativeSession: (trackId: string, deviceId: string) => boolean;
    /**
     * Whether that body takes notes: true for a built-in whose body takes
     * notes; a hosted device is admitted by its instance identity instead.
     */
    soundsNativeNotes: (deviceType: string) => boolean;
}>;

/**
 * The first device in chain order the session carries and that takes notes —
 * hosted (`externalInstanceId` is set) or a built-in whose type sounds notes.
 * A carried built-in effect is not a sink: the session can hold a body for it
 * without that body ever taking a note.
 */
export function resolveNativeNoteSink(instrumentTrack: Track, deps: NativeNoteSinkDependencies): Device | null {
    const carriedDevice = instrumentTrack.devices.find(
        (device) =>
            deps.isDeviceCarriedByNativeSession(instrumentTrack.id, device.id) &&
            (device.externalInstanceId !== undefined || deps.soundsNativeNotes(device.type))
    );
    return carriedDevice ?? null;
}
