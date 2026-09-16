/**
 * The channel views of a rendered buffer, in channel order, with every
 * non-finite sample zeroed.
 *
 * `getChannelData` returns the live Float32Array, so this hands out references
 * rather than copies: every reader here is read-only, and copying a
 * hundred-megabyte section render to measure it would cost more than the
 * analysis.
 *
 * A NaN or Infinity left in place reaches each metric differently — a peak of
 * Infinity, an RMS of NaN, a filtered block that stays NaN for the rest of the
 * signal — so one corrupt sample would put the receipt's figures in disagreement
 * with each other. Zeroing it once here is the only place that decision is made.
 */

/**
 * The channel itself when every sample is finite, otherwise a sanitised copy.
 * The render is a retained artifact its own owner may re-read, so the correction
 * is never written back into it.
 */
function withFiniteSamples(channel: Float32Array): Float32Array {
    let sanitized: Float32Array | null = null;
    for (let index = 0; index < channel.length; index++) {
        if (Number.isFinite(channel[index])) {
            continue;
        }
        sanitized ??= Float32Array.from(channel);
        sanitized[index] = 0;
    }
    return sanitized ?? channel;
}

export function readRenderChannels(buffer: AudioBuffer): Float32Array[] {
    const channels: Float32Array[] = [];
    for (let channelIndex = 0; channelIndex < buffer.numberOfChannels; channelIndex++) {
        channels.push(withFiniteSamples(buffer.getChannelData(channelIndex)));
    }
    return channels;
}
