import { trackStore } from '#/modules/Arrangement/stores';

import { fromCrumbsDeviceState } from '../models/CrumbsDeviceState';
import { defaultCrumbsState, type CrumbsState } from '../stores/crumbsStore';

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
            const playback = fromCrumbsDeviceState(device.deviceState);
            if (!playback) {
                return null;
            }
            return {
                ...defaultCrumbsState,
                mode: playback.mode,
                activeSample: playback.activeSample,
                // `setActiveSample` derives this from the sample on load; keep the
                // two paths agreeing so a reloaded sample plays at the pitch it was
                // saved at rather than at middle C.
                rootNote: playback.activeSample?.detectedRoot ?? defaultCrumbsState.rootNote,
            };
        }
    }
    return null;
}
