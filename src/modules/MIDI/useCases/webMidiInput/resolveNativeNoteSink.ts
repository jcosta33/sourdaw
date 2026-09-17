import type { Device, Track } from '#/modules/Arrangement/stores';

/**
 * The Crumbs sampler's device type, mirroring `CrumbsDescriptor`'s `id` and the
 * native mapper's own `CRUMBS_DEVICE_TYPE`.
 */
const CRUMBS_DEVICE_TYPE = 'builtin-crumbs';

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
 * hosted (`externalInstanceId` is set), Crumbs, or a built-in whose type sounds
 * notes. A carried built-in effect is not a sink: the session can hold a body
 * for it without that body ever taking a note.
 *
 * Crumbs needs no attach state of its own here (#4204). The carrier law already
 * refuses to carry a strip holding a Crumbs device the engine is not holding, so
 * a carried Crumbs device is an attached one by construction — and its note
 * store, like a hosted plugin's, exists because the instance was spliced in.
 */
export function resolveNativeNoteSink(instrumentTrack: Track, deps: NativeNoteSinkDependencies): Device | null {
    const carriedDevice = instrumentTrack.devices.find(
        (device) =>
            deps.isDeviceCarriedByNativeSession(instrumentTrack.id, device.id) &&
            (device.externalInstanceId !== undefined ||
                device.type === CRUMBS_DEVICE_TYPE ||
                deps.soundsNativeNotes(device.type))
    );
    return carriedDevice ?? null;
}
