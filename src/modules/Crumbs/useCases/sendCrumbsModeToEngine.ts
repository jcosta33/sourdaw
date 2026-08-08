import { getAllTracks } from '#/modules/Arrangement/useCases';
import { ensureTrackStrip } from '#/modules/AudioEngine/useCases';

import type { CrumbsMode } from '../models/CrumbsTypes';

/**
 * Tell the Crumbs node that is actually rendering about a mode change.
 *
 * The mode reached the session store and the native `CrumbsInstance` and stopped
 * there. The `crumbs-processor` worklet — the thing summed into the track strip —
 * learned its mode exactly once, at device build time
 * (`prepareCrumbsEngine.ts:136`), so switching Quick to Slice mid-session changed
 * the panel, the persisted document and an engine nobody was listening to, and
 * changed nothing audible. `crumbsControls.setMode` was published on the
 * rendering node (`wasmDeviceRegistry.ts:661`) and had no callers at all.
 *
 * Deliberately narrow. This is the missing *live* edge only: the store already
 * persists through `commitCrumbsDeviceState`, and a rebuilt or offline device
 * already reads the stored mode back through `prepareCrumbsEngine`, so nothing
 * here is a second source of truth. It is the mid-session case that had no path.
 *
 * Modelled on `resolveGrandBouleEngine`, including the part that fix was about:
 * the device id locates the owning track **and** selects the node, so a track
 * hosting two samplers switches the mode on the one the panel is addressing
 * rather than on whichever answers first.
 *
 * Silent when the device has no strip, no node, or a node that is not ready.
 * Every one of those is ordinary — a panel open on a device whose wasm module is
 * still loading, or on a device that has just been deleted — and the store write
 * that precedes this call is what the panel reads, so refusing loudly here would
 * report a failure to a user whose mode did change.
 */
export function sendCrumbsModeToEngine(deviceId: string, mode: CrumbsMode): void {
    const track = getAllTracks().find((candidate) => candidate.devices.some((device) => device.id === deviceId));
    if (!track) {
        return;
    }

    const strip = ensureTrackStrip(track.id);
    const deviceNode = strip.deviceNodes.find(
        (candidate) => candidate.deviceId === deviceId && candidate.crumbsControls?.ready === true
    );
    if (!deviceNode?.crumbsControls) {
        return;
    }

    deviceNode.crumbsControls.setMode(mode);
}
