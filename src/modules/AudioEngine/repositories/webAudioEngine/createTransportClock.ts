import { hasSharedArrayBuffer } from '#/utils/capabilities';

/**
 * Transport SharedArrayBuffer layout (one 72-byte buffer shared with worklet
 * readers, e.g. {@link kneadProcessor}).
 *
 * The transport fields are read as `Float64Array` slots 0–6 and 8; a single
 * 32-bit sequence counter lives at `Int32Array` index 14 (bytes 56–59, the low
 * half of the otherwise-unused 8th f64 slot). The counter guards every field
 * with a seqlock: the writer makes it odd before the field writes and even
 * after, and a reader retries while it is odd or changes across the read — so a
 * worklet never observes a snapshot torn across the non-atomic field writes.
 *
 * `positionSeconds` sits beside `beat` because a beat alone does not locate the
 * transport in time: converting one to the other means integrating the tempo
 * map, which lives on the main thread. A worklet that needs seconds — Knead,
 * whose pitch blobs are measured in them — reads the integration rather than
 * repeating it against the single `tempo` scalar, which is only the tempo in
 * force at the playhead and says nothing about the span behind it.
 *
 * `Atomics` requires an integer-typed view, hence the separate `Int32Array` for
 * the counter; the data fields stay `Float64Array` (they carry fractional beats
 * and tempo). Index/offset names are shared with the reader so both sides agree.
 */
const TRANSPORT_F64 = {
    beat: 0,
    tempo: 1,
    sampleRate: 2,
    loopStart: 3,
    loopEnd: 4,
    isPlaying: 5,
    isLooping: 6,
    positionSeconds: 8,
} as const;

/** Byte length of the transport SAB: 9 f64 slots (8 data + 1 holding the seq counter). */
const TRANSPORT_SAB_BYTES = 72;

/** `Int32Array` index of the seqlock sequence counter (byte offset 56, the 8th f64 slot). */
const TRANSPORT_SEQ_I32 = 14;

export type TransportClockSnapshot = Readonly<{
    beat: number;
    positionSeconds: number;
    tempo: number;
    isPlaying: boolean;
    loopStart: number;
    loopEnd: number;
    isLooping: boolean;
}>;

export type TransportClock = {
    /** The buffer worklet readers attach to, or `null` without SharedArrayBuffer or after {@link release}. */
    sharedBuffer(): SharedArrayBuffer | null;
    /** Publishes one seqlock-guarded snapshot; a no-op once there is no buffer. */
    write(snapshot: TransportClockSnapshot): void;
    /** Drops the buffer and its views so later writes no-op. */
    release(): void;
};

type TransportViews = {
    buffer: SharedArrayBuffer;
    value: Float64Array;
    seq: Int32Array;
};

function allocateTransportViews(): TransportViews | null {
    // The seven f64 data fields (slots 0–6) are guarded by a seqlock counter in
    // the Int32 view at TRANSPORT_SEQ_I32 so worklet readers never observe a
    // torn snapshot.
    //
    // Guard the allocation with hasSharedArrayBuffer(): without COOP+COEP the
    // global is absent and `new SharedArrayBuffer(...)` throws. This runs at
    // module load (`export const audioEngine = composeWebAudioEngine().engine`), so an
    // unguarded throw here aborts the whole module import on a non-isolated
    // page. When SAB is unavailable the views stay null and write no-ops, so
    // the worklet readers just fall back to their default transport — no torn
    // read, no import crash.
    if (!hasSharedArrayBuffer()) {
        return null;
    }
    const buffer = new SharedArrayBuffer(TRANSPORT_SAB_BYTES);
    const value = new Float64Array(buffer);
    const seq = new Int32Array(buffer);
    return { buffer, value, seq };
}

export type TransportClockPorts = Readonly<{
    /** Read inside each write, so the slot carries the rate of the context in force at that write. */
    readSampleRate: () => number;
}>;

export function createTransportClock({ readSampleRate }: TransportClockPorts): TransportClock {
    let views = allocateTransportViews();

    function write(snapshot: TransportClockSnapshot): void {
        if (!views) {
            // Released by dispose(); nothing to write into.
            return;
        }
        const { value, seq } = views;
        // Seqlock write: bump the counter to an odd value (write in progress),
        // publish the seven fields, then bump it to the next even value (write
        // complete). A worklet reader that samples an odd or changed counter
        // around its read retries, so it never sees a snapshot torn across the
        // seven plain f64 writes. The trailing Atomics.store also publishes the
        // field writes to other agents (release semantics).
        const odd = Atomics.load(seq, TRANSPORT_SEQ_I32) + 1;
        Atomics.store(seq, TRANSPORT_SEQ_I32, odd);
        value[TRANSPORT_F64.beat] = snapshot.beat;
        value[TRANSPORT_F64.tempo] = snapshot.tempo;
        value[TRANSPORT_F64.sampleRate] = readSampleRate();
        value[TRANSPORT_F64.loopStart] = snapshot.loopStart;
        value[TRANSPORT_F64.loopEnd] = snapshot.loopEnd;
        value[TRANSPORT_F64.isPlaying] = snapshot.isPlaying ? 1 : 0;
        value[TRANSPORT_F64.isLooping] = snapshot.isLooping ? 1 : 0;
        value[TRANSPORT_F64.positionSeconds] = snapshot.positionSeconds;
        Atomics.store(seq, TRANSPORT_SEQ_I32, odd + 1);
    }

    return {
        sharedBuffer: () => views?.buffer ?? null,
        write,
        release: () => {
            views = null;
        },
    };
}
