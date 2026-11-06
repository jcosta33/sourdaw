/**
 * Whether a parameter write to a device an insert step just added would change nothing, because the
 * device already holds exactly that value. `held` is what the owner reports a placed device starts
 * with (`getAddedDeviceParameterValues`), null for a type it cannot place. Only an identical value
 * counts, with no tolerance, so leaving the write out leaves the device exactly as writing it would.
 */
export function isWriteHeldByAddedDevice(
    held: Readonly<Record<string, number>> | null,
    paramId: string,
    value: number
): boolean {
    return held !== null && Object.is(held[paramId], value);
}
