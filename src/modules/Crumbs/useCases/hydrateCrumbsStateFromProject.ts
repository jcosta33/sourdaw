import { trackStore } from '#/modules/Arrangement/stores';

import { type CrumbsState } from '../stores/crumbsStore';

import { hydrateCrumbsStateFromDevice } from './hydrateCrumbsStateFromDevice';

/**
 * Read back the Crumbs state project truth holds for a device, or `null` when it
 * holds none.
 *
 * The counterpart to `commitCrumbsDeviceState`, and the half that makes a loaded
 * sample survive a reload. Without it the document could hold a perfectly good
 * sample path that nothing ever reads back, which is what left every reopened
 * project's Crumbs tracks silent — no error, no prompt to relocate the file.
 *
 * A pure read, matching `hydrateToasterKitFromProject`. The waveform peaks are not
 * restored: they are a display cache the panel refetches from the backend at the
 * width it is actually rendering, and storing a few thousand floats per device in
 * the document to save that call would be a poor trade.
 *
 * Two independent stores are read back, and either one alone is enough to answer.
 * The device-state chunk carries the mode and the sample; `parameterValues` carries
 * the knobs. A device whose knobs were moved but which was never given a sample has
 * the second and not the first, and returning `null` for it — as this did while the
 * chunk was the only source — would restore its engine from `parameterValues` while
 * handing the panel a module default, so the first knob touch would push that
 * default back over the saved settings.
 */
export function hydrateCrumbsStateFromProject(deviceId: string): CrumbsState | null {
    const tracks = trackStore.value?.tracks;
    if (!tracks) {
        return null;
    }

    for (const track of tracks) {
        for (const device of track.devices) {
            if (device.id !== deviceId) {
                continue;
            }

            return hydrateCrumbsStateFromDevice(device);
        }
    }
    return null;
}
