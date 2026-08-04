/**
 * Telemetry SAB Allocator — manages a single SharedArrayBuffer for all plugin telemetry.
 *
 * Each plugin instance gets a fixed-size slot in the SAB. AudioWorkletProcessors write
 * scalar telemetry directly into their slot — no structured clones, no IPC overhead.
 * The main thread polls from the same memory at rAF/setInterval intervals.
 *
 * Usage:
 *   const slot = telemetryAllocator.allocateSlot();
 *   // send { type: 'init-sab', sab: slot.sab, byteOffset: slot.byteOffset } to worklet port
 *   // read slot.view[GRINDER_IDX.inputDb] in your poll loop
 *   telemetryAllocator.releaseSlot(slot.byteOffset); // on device removal
 */

import { logger } from '#/infra/logger/appLogger';

/** Scalars reserved per plugin slot — sized for the largest telemetry set (Proof: 25 fields). */
export const FLOATS_PER_SLOT = 32;

/**
 * Index of the per-slot seqlock generation counter, read/written via Atomics on
 * {@link TelemetrySlot.seqView}. It is the last slot index (31), past every
 * field map (Proof's highest field is 24), so it never overlaps telemetry data.
 *
 * A writer (worklet) bumps it to an odd value before publishing the float
 * fields and to the next even value after; a reader samples it before and after
 * its field read and retries while it is odd or changed, so a poll never mixes
 * fields from two different writes (a torn snapshot — e.g. tap0 from a new block
 * with tap5 from the old).
 */
export const TELEMETRY_SEQ_IDX = FLOATS_PER_SLOT - 1;

const MAX_SLOTS = 64;
const BYTES_PER_SLOT = FLOATS_PER_SLOT * Float32Array.BYTES_PER_ELEMENT;

// ── Field index maps ─────────────────────────────────────────────────────────
// These MUST match the write order in each AudioWorkletProcessor.

export const GRINDER_IDX = Object.freeze({
    inputDb: 0,
    preampDb: 1,
    powerAmpDb: 2,
    outputDb: 3,
    gateOpen: 4,
    gateEnvelopeDb: 5,
    sagVoltage: 6,
    latency: 7,
    neuralCpuPercent: 8,
    neuralWarmupProgress: 9,
});

/**
 * Bacteria telemetry slot layout. The 6 band level scalars immediately
 * follow the fixed header so the worklet can blit them with a single
 * `.set(Float32Array)` copy from the Rust engine's `band_levels` array.
 */
export const BACTERIA_BAND_COUNT = 6;
export const BACTERIA_IDX = Object.freeze({
    inputDb: 0,
    outputDb: 1,
    latency: 2,
    bandLevelsBase: 3,
});

export const GLUTEN_IDX = Object.freeze({
    grDb: 0,
    inputDb: 1,
    outputDb: 2,
    crest: 3,
    phaseCorr: 4,
    latency: 5,
});

/**
 * Crust telemetry slot layout. `truePeakExceeded` is published as a float
 * because the slot is a `Float32Array`; the reader turns it back into a boolean.
 */
export const CRUST_IDX = Object.freeze({
    grDb: 0,
    inputDb: 1,
    outputDb: 2,
    lufsIntegrated: 3,
    lufsShortTerm: 4,
    lufsMomentary: 5,
    lra: 6,
    truePeakMax: 7,
    truePeakExceeded: 8,
    latency: 9,
});

/** active (0/1), then pitch fields. noteName is derived from noteIndex on the main thread. */
export const SCORING_IDX = Object.freeze({
    active: 0,
    frequency: 1,
    cents: 2,
    confidence: 3,
    noteIndex: 4,
    octave: 5,
    midiNote: 6,
});

export const PROOF_IDX = Object.freeze({
    inputLufs: 0,
    outputLufs: 1,
    outputStLufs: 2,
    integratedLufs: 3,
    truePeakDb: 4,
    lra: 5,
    correlation: 6,
    limiterGrDb: 7,
    dynGr0: 8,
    dynGr1: 9,
    dynGr2: 10,
    dynGr3: 11,
    tap0PeakL: 12,
    tap0PeakR: 13,
    tap1PeakL: 14,
    tap1PeakR: 15,
    tap2PeakL: 16,
    tap2PeakR: 17,
    tap3PeakL: 18,
    tap3PeakR: 19,
    tap4PeakL: 20,
    tap4PeakR: 21,
    tap5PeakL: 22,
    tap5PeakR: 23,
    latency: 24,
});

export const TOASTER_IDX = Object.freeze({
    lifecycle: 0,
});

// ── Wide slot layout: Fermenter ──────────────────────────────────────────────
//
// Fermenter's telemetry is a 128-sample oscilloscope waveform plus two peak
// scalars — 130 floats, which does not fit the pooled 32-float slot. It gets a
// dedicated SharedArrayBuffer (see {@link createWideTelemetrySlot}) laid out as
// a *superset* of the pooled slot rather than a new shape: floats 0..30 are the
// same scalar header any slot has, {@link TELEMETRY_SEQ_IDX} (31) carries the
// seqlock generation exactly as it does in every other telemetry SAB, and the
// waveform follows it. Keeping the counter at one fixed index for every
// telemetry SAB in the engine is what lets the worklet-side writer
// (services/telemetrySeqlock.ts) and {@link createTelemetryReader} be shared
// verbatim instead of forked per layout — the scalar indices 2..30 are unused
// headroom, not padding hiding a different protocol.

/** Oscilloscope samples Fermenter publishes per telemetry block. */
export const FERMENTER_SCOPE_SAMPLES = 128;

export const FERMENTER_IDX = Object.freeze({
    peakL: 0,
    peakR: 1,
    lifecycle: 2,
    /** First waveform sample — immediately past the seqlock counter. */
    scopeBase: FLOATS_PER_SLOT,
});

/** Total floats in a Fermenter telemetry SAB: scalar header + counter + waveform. */
export const FERMENTER_SLOT_FLOATS = FLOATS_PER_SLOT + FERMENTER_SCOPE_SAMPLES;

export type TelemetrySlot = {
    sab: SharedArrayBuffer;
    byteOffset: number;
    view: Float32Array;
    /**
     * Int32 view over the same slot bytes, used with Atomics on
     * {@link TELEMETRY_SEQ_IDX} for the seqlock. Float32 and Int32 share a 4-byte
     * stride, so this index aligns 1:1 with the Float32 `view` indices.
     */
    seqView: Int32Array;
};

// ── Seqlock reader ───────────────────────────────────────────────────────────

/**
 * Bound the seqlock retry so a misbehaving or stalled writer can never hang a
 * main-thread poll. At the 16 ms / rAF poll rates the nodes use, a snapshot that
 * loses this many races in a row is pathological, not routine.
 */
export const TELEMETRY_SEQ_MAX_RETRIES = 8;

export type CreateTelemetryReaderInput<TSnapshot> = {
    /** The device's telemetry slot — supplies both the float view and the counter. */
    slot: TelemetrySlot;
    /**
     * Projects the raw slot floats into the device's snapshot shape. Called once
     * per attempt, so it must be pure — no side effects the retry would repeat.
     */
    project: (view: Float32Array) => TSnapshot;
};

/**
 * Build the torn-free reader for one device slot (audit RT-2).
 *
 * The worklet publishes its fields under a generation counter (odd while
 * writing, even when settled — see services/telemetrySeqlock.ts). Each read
 * samples the counter before and after the projection and retries while it is
 * odd or moved, so a poll landing mid-write never mixes fields from two blocks.
 *
 * **Guarantee: a torn snapshot is never returned, in any case.** When the retry
 * budget runs out — a writer stalled or died with the counter stuck odd — the
 * reader returns the last snapshot that *passed* validation rather than the
 * projection that just failed it. Stale-but-consistent is the right failure
 * mode for a meter; handing the UI permanently torn cross-field data is not.
 * Before anything has validated, it returns the projection of a zeroed slot —
 * exactly what a freshly-allocated, never-written slot reads as, which is a
 * single consistent generation by construction.
 *
 * The retained snapshot is one value held in this closure, so it cannot grow
 * and it dies with the reader. Readers are built per node from that node's own
 * slot, and `allocateSlot()` mints fresh views every time, so a recycled slot
 * index can never inherit the previous tenant's cached snapshot.
 */
export function createTelemetryReader<TSnapshot>({
    slot,
    project,
}: CreateTelemetryReaderInput<TSnapshot>): () => TSnapshot {
    const { view, seqView } = slot;
    // Built once, here on the main thread, so no poll ever allocates it. Sized
    // from the slot's own view so a wide layout (Fermenter) zero-projects its
    // whole payload, not just the first FLOATS_PER_SLOT of it.
    let lastConsistent = project(new Float32Array(view.length));

    return (): TSnapshot => {
        for (let attempt = 0; attempt <= TELEMETRY_SEQ_MAX_RETRIES; attempt++) {
            const before = Atomics.load(seqView, TELEMETRY_SEQ_IDX);
            const snapshot = project(view);
            const after = Atomics.load(seqView, TELEMETRY_SEQ_IDX);
            if (before === after && (before & 1) === 0) {
                lastConsistent = snapshot;
                return snapshot;
            }
        }
        // Budget spent without a clean read. `snapshot` from the last attempt
        // failed validation, so it may be torn — discard it and hand back the
        // newest snapshot known to be internally consistent. The next poll
        // (16 ms / one frame) retries from scratch.
        return lastConsistent;
    };
}

// ── Allocator ────────────────────────────────────────────────────────────────

class TelemetryAllocator {
    private sab: SharedArrayBuffer | null = null;
    private freeSlots: number[] = [];

    private ensureInit(): SharedArrayBuffer {
        if (!this.sab) {
            this.sab = new SharedArrayBuffer(MAX_SLOTS * BYTES_PER_SLOT);
            for (let index = MAX_SLOTS - 1; index >= 0; index--) {
                this.freeSlots.push(index);
            }
        }
        return this.sab;
    }

    allocateSlot(): TelemetrySlot | null {
        const sab = this.ensureInit();
        const slotIndex = this.freeSlots.pop();
        if (slotIndex === undefined) {
            logger.warn('[TelemetryAllocator] No free telemetry slots (max 64 active plugins)');
            return null;
        }
        const byteOffset = slotIndex * BYTES_PER_SLOT;
        const view = new Float32Array(sab, byteOffset, FLOATS_PER_SLOT);
        const seqView = new Int32Array(sab, byteOffset, FLOATS_PER_SLOT);
        view.fill(0);
        return { sab, byteOffset, view, seqView };
    }

    releaseSlot(byteOffset: number): void {
        const slotIndex = byteOffset / BYTES_PER_SLOT;
        if (Number.isInteger(slotIndex) && slotIndex >= 0 && slotIndex < MAX_SLOTS) {
            this.freeSlots.push(slotIndex);
        }
    }
}

export const telemetryAllocator = new TelemetryAllocator();

export type CreateWideTelemetrySlotInput = {
    /** Total floats in the layout. Must exceed {@link TELEMETRY_SEQ_IDX}. */
    floats: number;
    /** Device name, for the diagnostic thrown when the layout is too small. */
    deviceName: string;
};

/**
 * Mint a standalone telemetry SAB for a device whose payload does not fit the
 * pooled {@link FLOATS_PER_SLOT} slot (today: Fermenter's 128-sample scope).
 *
 * It is deliberately NOT part of the 64-slot pool: the pool's slot stride is
 * what makes `releaseSlot(byteOffset)` reversible, and a wide buffer has no
 * index in it. A wide slot is owned outright by its node and reclaimed by GC
 * when the node drops it — never pass its `byteOffset` (always 0) to
 * `releaseSlot`, which would free pool slot 0 out from under its real tenant.
 *
 * The returned shape is an ordinary {@link TelemetrySlot}, so the shared
 * seqlock reader and the worklet-side writer work on it unchanged.
 */
export function createWideTelemetrySlot({ floats, deviceName }: CreateWideTelemetrySlotInput): TelemetrySlot | null {
    if (floats <= TELEMETRY_SEQ_IDX) {
        logger.warn(
            `[TelemetryAllocator] ${deviceName} wide slot of ${String(floats)} floats cannot hold the seqlock counter at index ${String(TELEMETRY_SEQ_IDX)}`
        );
        return null;
    }
    if (typeof SharedArrayBuffer === 'undefined') {
        // Not cross-origin-isolated. Fermenter's audio path does not depend on
        // the slot, so the caller degrades to a flat scope rather than failing
        // the device — see createFermenterNode.
        return null;
    }
    const sab = new SharedArrayBuffer(floats * Float32Array.BYTES_PER_ELEMENT);
    return {
        sab,
        byteOffset: 0,
        view: new Float32Array(sab, 0, floats),
        seqView: new Int32Array(sab, 0, floats),
    };
}
