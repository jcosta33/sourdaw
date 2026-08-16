/**
 * One place to answer "which node on this strip is the device I am about to
 * address?". The live-input handlers ask it once per device branch, and the
 * three ways they used to ask it were written out by hand at every site, so a
 * routing fix landed in some copies and not others (issue #1832 F15).
 *
 * The three shapes are kept exactly, because they are not interchangeable:
 *
 * - `{ type }` — the rack-routed branches, which have already established
 *   which device *kind* owns the voice and address the strip by kind.
 * - `{ deviceId, type }` — the direct note-on branches, which prefer the exact
 *   device instance but still accept the kind, because a strip built before the
 *   device carried an id would otherwise never be found.
 * - `{ deviceId }` — note-off, which must reach the *same instance* the
 *   matching note-on latched onto. Falling back to the kind here would release
 *   a different device's voice whenever a track hosts two of one kind, so the
 *   absence of `type` is load-bearing rather than an omission.
 */

type DeviceNodeIdentity = {
    deviceId?: string;
    type?: string;
};

/**
 * At least one criterion is required: a match on neither would silently return
 * the strip's first node or nothing at all depending on the array.
 */
export type DeviceNodeMatch = { deviceId: string; type?: string } | { deviceId?: string; type: string };

export function resolveDeviceNode<TNode extends DeviceNodeIdentity>(
    strip: { deviceNodes: readonly TNode[] } | undefined,
    match: DeviceNodeMatch
): TNode | undefined {
    if (!strip) {
        return undefined;
    }
    const deviceId = match.deviceId;
    const type = match.type;
    return strip.deviceNodes.find(
        (candidate) =>
            (deviceId !== undefined && candidate.deviceId === deviceId) ||
            (type !== undefined && candidate.type === type)
    );
}
