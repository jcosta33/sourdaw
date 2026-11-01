/**
 * Worklet-side seqlock writer for the shared telemetry SAB (audit RT-2).
 *
 * Every SAB device publishes a multi-field snapshot into its
 * `telemetryAllocator` slot with plain (non-atomic) float stores. A main-thread
 * poll landing between two of those stores would otherwise read a torn
 * snapshot — some fields from the current block, some from the previous one.
 * Bracketing the field writes with an odd/even generation counter lets the
 * reader (`readTelemetrySnapshot` in engine/telemetryAllocator.ts) detect the
 * overlap and retry.
 *
 * Protocol: the writer bumps the counter to an odd value BEFORE the fields and
 * to the next even value AFTER them. The reader accepts a snapshot only when
 * the counter is even and unchanged across its read.
 *
 * RT-safe: two `Atomics` read-modify-writes on an already-mapped view — no
 * allocation, no lock, no port traffic, bounded work.
 *
 * The index is duplicated (not imported) from engine/telemetryAllocator.ts on
 * purpose: worklet code stays isolated from app modules, so both sides pin the
 * same literal and the processor specs assert against it.
 */
export const TELEMETRY_SEQ_IDX = 31;

function bumpTelemetrySeq(seqView: Int32Array): void {
    Atomics.store(seqView, TELEMETRY_SEQ_IDX, Atomics.load(seqView, TELEMETRY_SEQ_IDX) + 1);
}

/**
 * Open the seqlock — counter goes odd ("write in progress"). A no-op when the
 * device has no slot yet, so the caller needs no extra guard.
 */
export function beginTelemetryPublish(seqView: Int32Array | null): void {
    if (!seqView) {
        return;
    }
    bumpTelemetrySeq(seqView);
}

/**
 * Close the seqlock — counter goes back to even ("settled"). Must pair 1:1 with
 * {@link beginTelemetryPublish}; an unpaired open leaves readers retrying until
 * their budget runs out and then reading a possibly-torn snapshot.
 */
export function endTelemetryPublish(seqView: Int32Array | null): void {
    if (!seqView) {
        return;
    }
    bumpTelemetrySeq(seqView);
}
