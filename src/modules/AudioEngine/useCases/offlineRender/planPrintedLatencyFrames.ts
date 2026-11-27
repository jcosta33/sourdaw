import { MAX_OFFLINE_FRAMES } from '../../repositories/clampRenderFrameCount';
import { getPrintedLatencyShift } from '../latencyCompensation/compensation/getPrintedLatencyShift';
import { type LatencyCompensationInput } from '../latencyCompensation/compensation/LatencyCompensationInput';

type PlanPrintedLatencyFramesInput = {
    /** The strip whose output the render prints. */
    trackId: string;
    /** The device latencies the render aligned its strips by; absent reads the live ones. */
    latency?: LatencyCompensationInput;
    /** Device types on the strip the render leaves out of its print (`unprintedDeviceTypes`). */
    unprintedDeviceTypes?: readonly string[];
    sampleRate: number;
    /** Frames the render holds without the shift, already within the renderer's cap. */
    baseFrameCount: number;
    onWarning?: (message: string) => void;
};

/**
 * The frames a render adds so the content of one strip's output that latency compensation pushes past its
 * end is printed, and that many frames cropped from its head put the content
 * back on the timeline.
 *
 * The renderer's cap is the only limit: a shift that does not fit is cut to the
 * room left, and the cut is reported because the last of the content is then
 * missing.
 */
export function planPrintedLatencyFrames({
    trackId,
    latency,
    unprintedDeviceTypes,
    sampleRate,
    baseFrameCount,
    onWarning,
}: PlanPrintedLatencyFramesInput): number {
    const shiftSeconds = getPrintedLatencyShift(trackId, latency, unprintedDeviceTypes);
    const wantedFrames = Math.max(0, Math.round(shiftSeconds * sampleRate));
    const roomFrames = Math.max(0, MAX_OFFLINE_FRAMES - baseFrameCount);
    if (wantedFrames <= roomFrames) {
        return wantedFrames;
    }
    onWarning?.(
        `This render is at the renderer's ${MAX_OFFLINE_FRAMES}-frame cap, so the last ` +
            `${((wantedFrames - roomFrames) / sampleRate).toFixed(3)} s that latency compensation delays ` +
            `past its end is not printed.`
    );
    return roomFrames;
}
