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

    // ── SPEC-offline-live-collapse AC-2 ───────────────────────────────────
    //
    // The pool is 64 slots, every metered native node takes one at
    // construction, and the only reclaim is `releaseSlot` from `destroy()`.
    // An `OfflineAudioContext` that is garbage-collected returns nothing, so
    // an export that never destroys what it built leaks permanently for the
    // page session — after which every meter added afterwards reads zero.
    describe('occupancy', () => {
        it('reports occupancy, so a render can be held to returning the pool to baseline', () => {
            const baseline = telemetryAllocator.occupiedSlotCount();

            const first = telemetryAllocator.allocateSlot();
            const second = telemetryAllocator.allocateSlot();
            if (!first || !second) {
                throw new Error('expected two free slots');
            }
            expect(telemetryAllocator.occupiedSlotCount()).toBe(baseline + 2);

            telemetryAllocator.releaseSlot(first.byteOffset);
            telemetryAllocator.releaseSlot(second.byteOffset);

            expect(telemetryAllocator.occupiedSlotCount()).toBe(baseline);
        });

        it('drains and refills without losing a slot', () => {
            const taken: number[] = [];
            for (;;) {
                const slot = telemetryAllocator.allocateSlot();
                if (!slot) {
                    break;
                }
                taken.push(slot.byteOffset);
            }
            expect(telemetryAllocator.occupiedSlotCount()).toBe(64);

            for (const byteOffset of taken) {
                telemetryAllocator.releaseSlot(byteOffset);
            }

            expect(telemetryAllocator.occupiedSlotCount()).toBe(0);
            const reallocated = telemetryAllocator.allocateSlot();
            expect(reallocated).not.toBeNull();
            if (reallocated) {
                allocatedOffsets.push(reallocated.byteOffset);
            }
        });

        /**
         * `releaseSlot` pushed the index back with no membership check, so a
         * double release put one index in the free list twice and the next two
         * allocations handed two devices the same bytes — each overwriting the
         * other's meters. It was unreachable while nothing called `destroy()`;
         * adding the offline teardown is exactly what makes it reachable, so it
         * is hardened in the same change rather than after the first report of
         * two devices sharing a meter.
         */
        it('refuses a second release of a slot that is already free', () => {
            const slot = telemetryAllocator.allocateSlot();
            if (!slot) {
                throw new Error('expected a free slot');
            }
            const occupiedBefore = telemetryAllocator.occupiedSlotCount();

            telemetryAllocator.releaseSlot(slot.byteOffset);
            telemetryAllocator.releaseSlot(slot.byteOffset);

            expect(telemetryAllocator.occupiedSlotCount()).toBe(occupiedBefore - 1);

            // The decisive half: two allocations after a double release must not
            // collide. Occupancy alone would pass on an allocator that hands the
            // same index out twice.
            const first = telemetryAllocator.allocateSlot();
            const second = telemetryAllocator.allocateSlot();
            if (!first || !second) {
                throw new Error('expected two free slots');
            }
            allocatedOffsets.push(first.byteOffset, second.byteOffset);
            expect(first.byteOffset).not.toBe(second.byteOffset);
        });

        it('ignores a release of a byte offset that was never allocated', () => {
            const occupied = telemetryAllocator.occupiedSlotCount();

            telemetryAllocator.releaseSlot(-128);
            telemetryAllocator.releaseSlot(64 * FLOATS_PER_SLOT * 4);
            telemetryAllocator.releaseSlot(7);

            expect(telemetryAllocator.occupiedSlotCount()).toBe(occupied);
        });
    });
});
