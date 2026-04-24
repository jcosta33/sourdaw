import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { FLOATS_PER_SLOT, telemetryAllocator, GRINDER_IDX } from '../telemetryAllocator';

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
