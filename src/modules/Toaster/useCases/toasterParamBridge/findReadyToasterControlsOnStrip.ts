type ToasterControlsLike = {
    ready: boolean;
    setPadParam: (pad: number, name: string, value: number) => void;
};

type StripLike = {
    deviceNodes: Array<{ deviceId?: string; toasterControls?: ToasterControlsLike }>;
};

type FindReadyToasterControlsOnStripInput = {
    strip: StripLike;
    deviceId: string;
};

/**
 * Pick the controls belonging to *this* Toaster, and only once it is loaded.
 *
 * Both halves matter and both were wrong at two call sites.
 *
 * Scoping: a track can host more than one Toaster. The old selector matched the
 * first node exposing toaster controls and ignored the `deviceId` it already
 * had in hand, so editing a pad on the second instance retuned the first.
 * `getToasterControls` was fixed for this once — its comment still records it —
 * and the two pad-param paths were left behind.
 *
 * Readiness: the old predicate was `toasterControls?.ready !== undefined`,
 * which is *true* when `ready` is `false`. It therefore matched a placeholder
 * controller for a device still loading, in preference to a real one further
 * down the chain, and wrote into a function that goes nowhere.
 *
 * This lives in one place so the predicate cannot drift apart again.
 */
export function findReadyToasterControlsOnStrip({
    strip,
    deviceId,
}: FindReadyToasterControlsOnStripInput): ToasterControlsLike | null {
    const node = strip.deviceNodes.find((data) => data.deviceId === deviceId && data.toasterControls?.ready);
    return node?.toasterControls ?? null;
}
