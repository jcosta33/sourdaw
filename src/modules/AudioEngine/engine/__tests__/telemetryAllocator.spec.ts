import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { FLOATS_PER_SLOT, telemetryAllocator, GRINDER_IDX, PROOF_IDX, TELEMETRY_SEQ_IDX } from '../telemetryAllocator';

describe('telemetryAllocator', () => {
    const allocatedOffsets: number[] = [];

    beforeEach(() => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        for (const off of allocatedOffsets.splice(0)) {
            telemetryAllocator.releaseSlot(off);
        }
        vi.restoreAllMocks();
    });

    it('should expose FLOATS_PER_SLOT aligned with index maps', () => {
        const maxIdx = Math.max(...Object.values(GRINDER_IDX));
        expect(maxIdx).toBeLessThan(FLOATS_PER_SLOT);
    });

    it('should allocate distinct slots with zeroed views', () => {
        const alpha = telemetryAllocator.allocateSlot();
        const b = telemetryAllocator.allocateSlot();
        expect(alpha).not.toBeNull();
        expect(b).not.toBeNull();
        if (!alpha || !b) {
            return;
        }

        allocatedOffsets.push(alpha.byteOffset, b.byteOffset);
        expect(alpha.byteOffset).not.toBe(b.byteOffset);
        expect(alpha.sab).toBe(b.sab);
        expect(alpha.view[0]).toBe(0);
        alpha.view[0] = 1.5;
        expect(b.view[0]).toBe(0);
    });

    it('should return a released slot for reuse', () => {
        const first = telemetryAllocator.allocateSlot();
        expect(first).not.toBeNull();
        if (!first) {
            return;
        }

        const off = first.byteOffset;
        allocatedOffsets.push(off);
        telemetryAllocator.releaseSlot(off);
        allocatedOffsets.pop();

        const again = telemetryAllocator.allocateSlot();
        expect(again).not.toBeNull();
        if (!again) {
            return;
        }
        allocatedOffsets.push(again.byteOffset);
        expect(again.byteOffset).toBe(off);
    });

    // ── Fix 7: each slot exposes an Int32 seqView aligned with its Float32 view
    // so the telemetry seqlock counter can be read/written with Atomics. ──
    describe('seqlock view', () => {
        it('places the seq counter index past every telemetry field', () => {
            // The counter must not overlap any data field; Proof has the highest.
            const maxProofField = Math.max(...Object.values(PROOF_IDX));
            expect(TELEMETRY_SEQ_IDX).toBeGreaterThan(maxProofField);
            expect(TELEMETRY_SEQ_IDX).toBeLessThan(FLOATS_PER_SLOT);
        });

        it('exposes an Int32 seqView aligned 1:1 with the Float32 view over the same slot', () => {
            const slot = telemetryAllocator.allocateSlot();
            expect(slot).not.toBeNull();
            if (!slot) {
                return;
            }
            allocatedOffsets.push(slot.byteOffset);

            // Atomics on the seq view must round-trip, and writing the counter must
            // not corrupt the data fields (the counter lives in its own slot).
            slot.view[PROOF_IDX.integratedLufs] = -16;
            Atomics.store(slot.seqView, TELEMETRY_SEQ_IDX, 2);
            expect(Atomics.load(slot.seqView, TELEMETRY_SEQ_IDX)).toBe(2);
            expect(slot.view[PROOF_IDX.integratedLufs]).toBeCloseTo(-16, 5);

            // The seqView spans the same slot bytes as the float view.
            expect(slot.seqView.length).toBe(slot.view.length);
            expect(slot.seqView.byteOffset).toBe(slot.view.byteOffset);
        });
    });

    it('should return null and warn when no slots remain', () => {
        const slots: NonNullable<ReturnType<typeof telemetryAllocator.allocateSlot>>[] = [];
        for (;;) {
            const state = telemetryAllocator.allocateSlot();
            if (!state) {
                break;
            }
            slots.push(state);
        }
        for (const state of slots) {
            allocatedOffsets.push(state.byteOffset);
        }

        expect(slots.length).toBe(64);
        expect(telemetryAllocator.allocateSlot()).toBeNull();
        expect(console.warn).toHaveBeenCalled();
    });
});
