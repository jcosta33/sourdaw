/**
 * PCM shape conversion at the native-graph wire, outbound half.
 *
 * `render_graph_offline` answers interleaved stereo f32 **little-endian**
 * bytes — the encoding is the wire contract's (`graph.rs` encodes with
 * `f32::to_le_bytes`), so the read goes through a `DataView` with explicit
 * endianness rather than assuming the host's.
 */

const BYTES_PER_SAMPLE = 4;

export type PlanarStereo = Readonly<{
    left: Float32Array<ArrayBuffer>;
    right: Float32Array<ArrayBuffer>;
}>;

/**
 * The renderer's interleaved stereo f32 LE answer, back into the planar pair
 * every consumer of a render holds. Refuses a payload whose byte length is not
 * exactly `frames` stereo frames: a truncated response silently zero-padded
 * would read as a render that went quiet.
 */
export function deinterleaveStereoPcm(input: { bytes: Uint8Array; frames: number }): PlanarStereo {
    const { bytes, frames } = input;
    const expected = frames * 2 * BYTES_PER_SAMPLE;
    if (bytes.byteLength !== expected) {
        throw new Error(
            `render_graph_offline answered ${String(bytes.byteLength)} bytes for ${String(frames)} frames; ` +
                `expected ${String(expected)}`
        );
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const left = new Float32Array(frames);
    const right = new Float32Array(frames);
    for (let frame = 0; frame < frames; frame++) {
        left[frame] = view.getFloat32(frame * 2 * BYTES_PER_SAMPLE, true);
        right[frame] = view.getFloat32((frame * 2 + 1) * BYTES_PER_SAMPLE, true);
    }
    return { left, right };
}
