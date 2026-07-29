/**
 * Thrown when the app has *no implementation at all* for a device type on the
 * offline render path — a coverage hole in our own code, not an environment or
 * asset problem.
 *
 * This exists because "no factory matched the type" is not the only shape a
 * coverage hole takes, and matching on message text is not a contract. The
 * `builtin-` prefix matcher claims every `builtin-*` id, so `builtin-crumbs`
 * reached `createWebAudioDevice`, which then threw a plain `Error` reading
 * "Unknown WebAudio device type". Splitting on "did a factory match?" would
 * therefore have filed Crumbs — a device with no WebAudio node anywhere — as a
 * runtime failure to degrade past, which is exactly the wrong bucket.
 *
 * Both "no matcher claimed this type" and "a matcher claimed it but no node
 * exists for it" are the same defect from the user's side: the export cannot
 * contain what playback contains. Both throw this type; every other failure
 * (missing WASM asset, unavailable worklet, Faust compile error, missing
 * cross-origin isolation) stays a plain error and stays degradable.
 */
export class UnsupportedDeviceTypeError extends Error {
    readonly deviceType: string;

    constructor(deviceType: string, reason: string) {
        super(`No offline audio implementation for device type "${deviceType}": ${reason}`);
        this.name = 'UnsupportedDeviceTypeError';
        this.deviceType = deviceType;
    }
}

export function isUnsupportedDeviceTypeError(error: unknown): error is UnsupportedDeviceTypeError {
    return error instanceof UnsupportedDeviceTypeError;
}
