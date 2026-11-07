type CountRenderFramesInput = {
    durationSeconds: number;
    sampleRate: number;
};

/**
 * The frames a render of this duration holds before the renderer's cap. A frame
 * position derived from a render's length, such as the end of a cropped region,
 * counts with this rule so it cannot land past the rendered buffer.
 */
export function countRenderFrames({ durationSeconds, sampleRate }: CountRenderFramesInput): number {
    return Math.ceil(durationSeconds * sampleRate);
}
