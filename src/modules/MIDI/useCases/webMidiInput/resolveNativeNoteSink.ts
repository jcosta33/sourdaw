import { resolveLiveInputNoteReceiver } from './resolveLiveInputNoteReceiver';

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
 * hosted (`externalInstanceId` is set), or the track's receiving built-in
 * instrument (`resolveLiveInputNoteReceiver`) when it is Crumbs or a built-in
 * whose type sounds notes. A carried built-in effect is not a sink: the session
 * can hold a body for it without that body ever taking a note.
 *
 * A built-in sink is the receiver and no other built-in, so the engine voices
 * the instrument the Web Audio route, playback and the export voice. While the
 * receiver is not carried (a device added mid-roll that no splice has placed
 * yet, or one the mapper degraded) no built-in behind it takes the key: the key
 * falls to the Web Audio route, which sends it to that same receiver, and a
 * carried strip's Web Audio twin is gated out of the mix, so the key stays
 * silent until the receiver is spliced in rather than sounding another device.
 *
 * Crumbs needs no attach state of its own here (#4204). The carrier law already
 * refuses to carry a strip holding a Crumbs device the engine is not holding, so
 * a carried Crumbs device is an attached one by construction — and its note
 * store, like a hosted plugin's, exists because the instance was spliced in.
 */
export function resolveNativeNoteSink(instrumentTrack: Track, deps: NativeNoteSinkDependencies): Device | null {
    const receiver = resolveLiveInputNoteReceiver(instrumentTrack.devices, false)?.device;
    const carriedDevice = instrumentTrack.devices.find(
        (device) =>
            deps.isDeviceCarriedByNativeSession(instrumentTrack.id, device.id) &&
            (device.externalInstanceId !== undefined ||
                (device === receiver && (device.type === CRUMBS_DEVICE_TYPE || deps.soundsNativeNotes(device.type))))
    );
    return carriedDevice ?? null;
}
