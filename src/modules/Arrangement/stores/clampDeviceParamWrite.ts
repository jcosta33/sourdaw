import { clampDeviceParameterValue } from '../models/DeviceParameterLaw';

import { trackStore } from './trackStore';

type ClampDeviceParamWriteInput = {
    deviceId: string;
    paramId: string;
    value: number;
};

type TrackList = NonNullable<typeof trackStore.value>['tracks'];

/**
 * device id → device type, rebuilt only when the store hands back a different
 * `tracks` array.
 *
 * This resolution sits on every engine-bound parameter write: the automation
 * tick for each driving lane, and once per stored parameter when a project
 * rebuilds its strips. A per-write linear scan there would be O(devices) on a
 * path that previously did no work at all, so the lookup is an index rather
 * than a search. (No measured regression prompted this — it is the cheap
 * shape, chosen up front, not a fix for an observed one.)
 *
 * Keying on the array's identity is sound because every writer replaces it
 * rather than mutating it (see `persistDeviceParam`), and a device's `type` is
 * fixed for the life of its id in any case.
 */
let indexedTracks: TrackList | null = null;
let indexedDeviceTypes: Map<string, string> = new Map();

function deviceTypeIndex(tracks: TrackList): Map<string, string> {
    if (indexedTracks === tracks) {
        return indexedDeviceTypes;
    }

    const deviceTypes = new Map<string, string>();
    for (const track of tracks) {
        for (const device of track.devices) {
            deviceTypes.set(device.id, device.type);
        }
    }

    indexedTracks = tracks;
    indexedDeviceTypes = deviceTypes;
    return deviceTypes;
}

/**
 * The value a device-parameter write is allowed to land, resolved from the
 * device id alone.
 *
 * The declared range lives on the plugin descriptor and is keyed by
 * `Device.type`, but the engine-facing write surface — AudioEngine's
 * `updateDeviceParam` — only ever receives an id. Resolving the type here lets
 * the law bind at that one door rather than at each of the twenty call sites
 * that reach it, so a bridge, a preset, a project rebuild and a curve all pass
 * through the same check.
 *
 * Colocated with the store instance rather than `useCases/` for the same reason
 * `persistDeviceParam` is: `AudioEngine/useCases` already depends on
 * `Arrangement/stores`, while reaching `Arrangement/useCases` from there would
 * close a module cycle through preset command compilation.
 *
 * Fails open. A device the store does not know — one mid-attach, an offline
 * render strip, a test double — has no reachable declared contract, and
 * refusing or zeroing its write would be worse than passing it through.
 */
export function clampDeviceParamWrite({ deviceId, paramId, value }: ClampDeviceParamWriteInput): number {
    const tracks = trackStore.value?.tracks;
    if (!tracks) {
        return value;
    }

    const deviceType = deviceTypeIndex(tracks).get(deviceId);
    if (deviceType === undefined) {
        return value;
    }

    return clampDeviceParameterValue({ deviceType, paramId, value });
}
