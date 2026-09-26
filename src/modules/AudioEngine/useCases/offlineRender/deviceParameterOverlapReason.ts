/**
 * The decline text a caller uses for the first overlap it is not prepared to
 * keep pieces of — `projectStripAutomationWrites` reports the clash on its
 * result's `overlaps` field rather than declining itself, so the callers that
 * must (the native export, which has no per-lane fallback) or that name the
 * clashing lane instead (the live producer) share this one format rather than
 * each spelling it out.
 */
export function deviceParameterOverlapReason(
    trackName: string,
    overlap: { deviceId: string; parameterId: string }
): string {
    return `automation on track "${trackName}": lanes on device "${overlap.deviceId}" overlap on parameter "${overlap.parameterId}"`;
}
