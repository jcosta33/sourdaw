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

/** Scalars reserved per plugin slot — sized for the largest telemetry set (Proof: 25 fields). */
export const FLOATS_PER_SLOT = 32;

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

export const BACTERIA_IDX = Object.freeze({
    inputDb: 0,
    outputDb: 1,
    latency: 2,
});

export const GLUTEN_IDX = Object.freeze({
    grDb: 0,
    inputDb: 1,
    outputDb: 2,
    crest: 3,
    phaseCorr: 4,
    latency: 5,
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

export type TelemetrySlot = {
    sab: SharedArrayBuffer;
    byteOffset: number;
    view: Float32Array;
};

// ── Allocator ────────────────────────────────────────────────────────────────

class TelemetryAllocator {
    private sab: SharedArrayBuffer | null = null;
    private freeSlots: number[] = [];

    private ensureInit(): SharedArrayBuffer {
        if (!this.sab) {
            this.sab = new SharedArrayBuffer(MAX_SLOTS * BYTES_PER_SLOT);
            for (let i = MAX_SLOTS - 1; i >= 0; i--) {
                this.freeSlots.push(i);
            }
        }
        return this.sab;
    }

    allocateSlot(): TelemetrySlot | null {
        const slotIndex = this.freeSlots.pop();
        if (slotIndex === undefined) {
            console.warn('[TelemetryAllocator] No free telemetry slots (max 64 active plugins)');
            return null;
        }
        const sab = this.ensureInit();
        const byteOffset = slotIndex * BYTES_PER_SLOT;
        const view = new Float32Array(sab, byteOffset, FLOATS_PER_SLOT);
        view.fill(0);
        return { sab, byteOffset, view };
    }

    releaseSlot(byteOffset: number): void {
        const slotIndex = byteOffset / BYTES_PER_SLOT;
        if (Number.isInteger(slotIndex) && slotIndex >= 0 && slotIndex < MAX_SLOTS) {
            this.freeSlots.push(slotIndex);
        }
    }
}

export const telemetryAllocator = new TelemetryAllocator();
