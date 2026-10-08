import { getAllTracks } from '#/modules/Arrangement/useCases';
import { ensureTrackStrip } from '#/modules/AudioEngine/useCases';

import type { EventBus } from '#/infra/events/types';
import type { AppEvents } from './registerDependencies';

/**
 * The strip half of every Crumbs mode change, panel and peer alike (#4764).
 *
 * The mode used to reach the strip through `sendCrumbsModeToEngine` in the
 * Crumbs module. That push was missing for the whole life of the mode defect
 * before it: the mode reached the session store and the native
 * `CrumbsInstance` and stopped there, because the `crumbs-processor` worklet —
 * the thing summed into the track strip — learned its mode exactly once, at
 * device build time, so a mid-session Quick→Slice changed the panel, the
 * persisted document and an engine nobody was listening to.
 *
 * It cannot live behind the Crumbs barrel: AudioEngine imports that barrel
 * (`markAttachedCrumbsInstances`), so a barrel-reachable path back into the
 * strip's owner closes a `no-circular` cycle the boundary gate refuses. The
 * module therefore signals on `crumbs.modeChanged` (its emitter is injected
 * with `setCrumbsEventBus` at the composition root) and this app seam, which
 * may reach both barrels, tells the node that is actually rendering.
 *
 * Silent when the device has no strip, no node, or a node that is not ready —
 * each of them ordinary, and the store write that precedes the signal is what
 * the panel reads.
 */
export function initCrumbsModePush(eventBus: EventBus<AppEvents>): void {
    eventBus.on('crumbs.modeChanged', ({ deviceId, mode }) => {
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
    });
}
