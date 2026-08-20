/**
 * PCM shape conversion at the native-graph wire, inbound half.
 *
 * `register_timeline_sample` takes interleaved f32 **little-endian** bytes —
 * the byte order is part of the wire contract (`graph.rs` decodes with
 * `f32::from_le_bytes`), so the write goes through a `DataView` with explicit
 * endianness rather than assuming the host's.
 */

const BYTES_PER_SAMPLE = 4;

export type InterleavedPcm = Readonly<{
    channels: 1 | 2;
    frames: number;
    pcm: Uint8Array;
}>;

/**
 * An `AudioBuffer`'s material as the interleaved f32 LE payload the native
 * sample pool takes. Mono and stereo are the pool's whole vocabulary; anything
 * wider throws here, with the source's name, instead of crossing the wire to
 * be refused by a message that no longer knows which clip it was.
 */
export function interleaveAudioBufferPcm(input: { sourceId: string; buffer: AudioBuffer }): InterleavedPcm {
    const { sourceId, buffer } = input;
    if (buffer.numberOfChannels !== 1 && buffer.numberOfChannels !== 2) {
        throw new Error(
            `clip source "${sourceId}" carries ${String(buffer.numberOfChannels)} channels; ` +
                'the native sample pool takes mono or stereo'
        );
    }
    const channels = buffer.numberOfChannels;
    const frames = buffer.length;
    const bytes = new Uint8Array(frames * channels * BYTES_PER_SAMPLE);
    const view = new DataView(bytes.buffer);
    const left = buffer.getChannelData(0);
    const right = channels === 2 ? buffer.getChannelData(1) : undefined;
    for (let frame = 0; frame < frames; frame++) {
        view.setFloat32(frame * channels * BYTES_PER_SAMPLE, left[frame] ?? 0, true);
        if (right) {
            view.setFloat32((frame * channels + 1) * BYTES_PER_SAMPLE, right[frame] ?? 0, true);
        }
    }
    return { channels, frames, pcm: bytes };
}
