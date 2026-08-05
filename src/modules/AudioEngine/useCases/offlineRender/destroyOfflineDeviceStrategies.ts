import { logger } from '#/infra/logger/appLogger';

import { type DeviceNodeEntry } from '../buildDeviceChain';

/**
 * Release every device strategy an offline render constructed.
 *
 * **Why an offline render has to do this at all.** Every metered native node
 * takes a slot from the shared 64-slot telemetry pool at construction, and the
 * only thing that gives one back is `releaseSlot` from the node's `destroy()`.
 * A garbage-collected `OfflineAudioContext` returns nothing — the slot lives in
 * a `SharedArrayBuffer` the allocator owns, not in the context — so a render
 * that never destroys what it built leaks for the whole page session. Live
 * playback already destroys its devices (`TrackNode` does it on removal, on
 * chain rebuild and on disposal); the offline paths had no caller at all, so
 * roughly sixty-four devices' worth of exports silently killed gain-reduction,
 * LUFS, tuner and gate meters for every device added afterwards.
 *
 * **Called on every exit, not only the success path.** A render that times out,
 * fails on a runtime fault or is cancelled built exactly as many devices as one
 * that finished, so teardown belongs in a `finally` rather than after the
 * buffer. That is the whole reason this is a function and not three lines
 * inlined at three return sites.
 *
 * **A device that throws on destroy does not stop the rest.** Teardown runs
 * after the render has already produced (or failed to produce) its buffer, so
 * aborting the loop over one bad node would strand every slot behind it — the
 * exact leak this exists to prevent, with an extra step.
 */
export function destroyOfflineDeviceStrategies(deviceEntriesByTrack: ReadonlyMap<string, DeviceNodeEntry[]>): void {
    for (const entries of deviceEntriesByTrack.values()) {
        for (const entry of entries) {
            try {
                entry.strategy.destroy?.();
            } catch (error) {
                const reason = error instanceof Error ? error.message : String(error);
                logger.warn(
                    `[offlineRender] ${entry.deviceType} (${entry.deviceId}) threw while being torn down: ${reason}`
                );
            }
        }
    }
}
