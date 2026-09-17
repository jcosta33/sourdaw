/**
 * The two constants of the BS.1770-4 loudness equation
 * `L_K = -0.691 + 10 · log10(Σ G_i · z_i)`: the scale offset and the per-channel
 * weights `G_i`. Gated and windowed readings share them so the same signal
 * cannot report two different loudness scales.
 */

export const LOUDNESS_OFFSET = -0.691;

/**
 * Per-channel weight (BS.1770-4 Table 4). Only the first five are defined;
 * anything beyond a 5.0 layout is weighted as a surround channel.
 */
export function loudnessChannelWeight(channelIndex: number): number {
    if (channelIndex < 3) {
        return 1;
    }
    return 1.41;
}
