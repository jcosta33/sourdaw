import { trackStore } from '#/modules/Arrangement/stores';

import { fromLevainDeviceState } from '../models/LevainDeviceState';
import { createDefaultPatch } from '../models/LevainPatch';
import { defaultLevainState, type LevainState } from '../stores/levainStore';

import { hydrateLevainPatchFromParameterValues } from './hydrateLevainPatchFromParameterValues';

/**
 * Read back the Levain state project truth holds for a device, or `null` when it
 * holds none.
 *
 * The counterpart to `commitLevainDeviceState`, and the half that makes an
 * instrument choice survive a reload: registration alone gives every device the
 * default patch, so without this the document could hold a perfectly good
 * instrument id that nothing ever reads back — which is exactly why a reopened
 * orchestral arrangement played violin-1 on the cello, horn and timpani tracks.
 *
 * A pure read on purpose, matching `hydrateToasterKitFromProject`. The resolved
 * state is handed to the caller so the device's session entry is *created* holding
 * it, in one store write. Loading it afterwards would work too, but the second
 * change is indistinguishable from a user edit, so the persistence subscriber would
 * mirror the freshly loaded patch straight back into the document and dirty a
 * project nobody had touched.
 *
 * Instrument identity comes from `Device.deviceState` when the user selected one;
 * otherwise the module default remains the identity. Numeric patch values come from
 * `Device.parameterValues` and overlay that instrument's defaults, so reopening a
 * project reconstructs the same engine state that live registration and offline
 * rendering apply even when an older file has no opaque Levain chunk.
 */
export function hydrateLevainStateFromProject(deviceId: string): LevainState | null {
    const tracks = trackStore.value?.tracks;
    if (!tracks) {
        return null;
    }

    for (const track of tracks) {
        for (const device of track.devices) {
            if (device.id !== deviceId) {
                continue;
            }
            const identity = fromLevainDeviceState(device.deviceState);
            const instrumentId = identity?.instrumentId ?? defaultLevainState.patch.instrumentId;
            const defaultPatch = createDefaultPatch(instrumentId);
            const currentArticulation = identity?.currentArticulation ?? defaultPatch.currentArticulation;
            const patch = hydrateLevainPatchFromParameterValues({
                patch: { ...defaultPatch, currentArticulation },
                parameterValues: device.parameterValues,
            });
            const entry = patch.articulations.find((articulation) => articulation.type === currentArticulation);
            return {
                ...defaultLevainState,
                patch,
                currentArticulationDisplay: entry ? entry.name : currentArticulation,
            };
        }
    }
    return null;
}
