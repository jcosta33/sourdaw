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
        const a = telemetryAllocator.allocateSlot();
        const b = telemetryAllocator.allocateSlot();
        expect(a).not.toBeNull();
        expect(b).not.toBeNull();
        if (!a || !b) {
            return;
        }

        allocatedOffsets.push(a.byteOffset, b.byteOffset);
        expect(a.byteOffset).not.toBe(b.byteOffset);
        expect(a.sab).toBe(b.sab);
        expect(a.view[0]).toBe(0);
        a.view[0] = 1.5;
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
            const s = telemetryAllocator.allocateSlot();
            if (!s) {
                break;
            }
            slots.push(s);
        }
        for (const s of slots) {
            allocatedOffsets.push(s.byteOffset);
        }

        expect(slots.length).toBe(64);
        expect(telemetryAllocator.allocateSlot()).toBeNull();
        expect(console.warn).toHaveBeenCalled();
    });
});
