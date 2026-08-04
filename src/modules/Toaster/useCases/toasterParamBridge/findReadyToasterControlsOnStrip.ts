import { findToasterNodeOnStrip, type ToasterStrip, type ToasterStripDeviceNode } from './findToasterNodeOnStrip';

type ToasterControls = NonNullable<ToasterStripDeviceNode['toasterControls']>;

type FindReadyToasterControlsOnStripInput = {
    strip: ToasterStrip;
    deviceId: string;
};

/**
 * Controls for *this* Toaster, and only once it has finished loading.
 *
 * Device scoping is delegated to `findToasterNodeOnStrip` — that half is
 * correct for every caller. Readiness is *not* shared, because it is not:
 *
 * - **Pad writes need it.** A device still loading publishes a placeholder
 *   controller whose `setPadParam` is an empty function
 *   (`AudioEngine/engine/wasmDeviceRegistry.ts`), so the write is dropped on
 *   the floor. The predicate here used to be `ready !== undefined`, which is
 *   *true* when `ready` is `false`, so the placeholder was matched in
 *   preference to a real loaded device further down the chain.
 * - **Kit writes must not have it.** The same placeholder's `setParam` pushes
 *   into `pendingParams`, and the loader replays that buffer once the worklet
 *   is up. `setToasterKitParam` therefore writes through a not-ready node on
 *   purpose; gating it on readiness would discard every kit edit made while
 *   the device loads, instead of deferring it.
 *
 * So reach for this from `setPadParam` paths. Where a not-ready write is the
 * point, call `findToasterNodeOnStrip` directly and skip the gate.
 */
export function findReadyToasterControlsOnStrip({
    strip,
    deviceId,
}: FindReadyToasterControlsOnStripInput): ToasterControls | null {
    const controls = findToasterNodeOnStrip({ strip, deviceId })?.toasterControls;
    if (!controls?.ready) {
        return null;
    }
    return controls;
}
