/**
 * The channel views of a rendered buffer, in channel order.
 *
 * `getChannelData` returns the live Float32Array, so this hands out references
 * rather than copies: every reader here is read-only, and copying a
 * hundred-megabyte section render to measure it would cost more than the
 * analysis.
 */
export function readRenderChannels(buffer: AudioBuffer): Float32Array[] {
    const channels: Float32Array[] = [];
    for (let channelIndex = 0; channelIndex < buffer.numberOfChannels; channelIndex++) {
        channels.push(buffer.getChannelData(channelIndex));
    }
    return channels;
}
