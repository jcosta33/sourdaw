/**
 * Where a device belongs in the engine's chain, given the project order around
 * it (#3575).
 *
 * Project positions and native positions are not the same number. A device the
 * mapper could not build is omitted from the chain it was asked for, so every
 * device behind it sits one slot earlier natively than it does in the project.
 * An insert addressed by its project index would land on the wrong side of its
 * neighbour, and the chain a musician hears would stop matching the one they
 * are looking at.
 *
 * So the index is counted rather than read: how many of the devices ahead of
 * this one in the project chain the engine actually holds.
 */

/**
 * @param projectOrder device ids in project order, the chain as it should end up
 * @param deviceId the device being placed
 * @param nativeChain device ids the engine holds now, in graph order
 */
export function nativeInsertIndex(
    projectOrder: readonly string[],
    deviceId: string,
    nativeChain: readonly string[]
): number {
    const held = new Set(nativeChain);
    let index = 0;
    for (const candidate of projectOrder) {
        if (candidate === deviceId) {
            return index;
        }
        if (held.has(candidate)) {
            index += 1;
        }
    }
    // The device is not in the project order at all, which only a caller
    // holding a stale chain can produce. Appending is the one placement that
    // cannot displace a device whose position is known.
    return index;
}
