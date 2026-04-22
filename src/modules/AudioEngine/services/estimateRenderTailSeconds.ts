type DeviceLike = {
    type: string;
    parameterValues: Record<string, number>;
    bypassed: boolean;
};

type TrackLike = {
    devices: DeviceLike[];
};

/**
 * Inspect a project's tracks for reverb/delay devices and estimate the longest
 * tail the export should preserve, in seconds. Used by the "auto-detect tail"
 * option in the export dialog and by bounce operations.
 */
export function estimateRenderTailSeconds(tracks: ReadonlyArray<TrackLike>): number {
    let maxTail = 0;

    for (const track of tracks) {
        for (const device of track.devices) {
            if (device.bypassed) {
                continue;
            }

            if (device.type === 'builtin-reverb') {
                const decay = device.parameterValues['rev-decay'] ?? 2;
                if (decay > maxTail) {
                    maxTail = decay;
                }
            }

            if (device.type === 'builtin-delay') {
                const delayTimeMs = device.parameterValues['delay-time'] ?? 250;
                const feedback = Math.min(0.95, Math.max(0, device.parameterValues['delay-feedback'] ?? 0.3));
                if (feedback <= 0) {
                    continue;
                }
                const feedbackTailSec = (delayTimeMs / 1000) * (Math.log(0.001) / Math.log(feedback));
                if (Number.isFinite(feedbackTailSec) && feedbackTailSec > maxTail) {
                    maxTail = feedbackTailSec;
                }
            }
        }
    }

    return Math.min(30, Math.max(0, maxTail));
}
