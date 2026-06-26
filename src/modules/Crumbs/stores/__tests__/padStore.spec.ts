import { describe, it, expect, beforeEach } from 'vitest';

import { DEFAULT_PAD_COUNT } from '../../models/CrumbsTypes';
import { type PadState, padStore, ensurePadInstance, reorderPad } from '../padStore';

const INSTANCE = 'inst-A';

/** Read the instance state, asserting it exists so the test fails loudly if not. */
function readInstance(): PadState {
    const inst = padStore.value?.[INSTANCE];
    if (!inst) {
        throw new Error(`expected instance ${INSTANCE} to exist`);
    }
    return inst;
}

describe('reorderPad', () => {
    beforeEach(() => {
        padStore.set({});
        ensurePadInstance(INSTANCE);
    });

    it('moves the pad and its channel strip together, preserving both arrays', () => {
        const before = readInstance();
        const firstPad = before.pads[0];
        expect(firstPad).toBeDefined();
        const movedPadId = firstPad?.id;

        reorderPad(INSTANCE, 0, 3);

        const after = readInstance();
        // Pad that was at index 0 now sits at index 3.
        expect(after.pads[3]?.id).toBe(movedPadId);
        // No pad or strip was dropped.
        expect(after.pads).toHaveLength(DEFAULT_PAD_COUNT);
        expect(after.channelStrips).toHaveLength(DEFAULT_PAD_COUNT);
    });

    it('keeps pads and channelStrips the same length after a reorder', () => {
        reorderPad(INSTANCE, 1, DEFAULT_PAD_COUNT - 1);

        const after = readInstance();
        expect(after.pads.length).toBe(after.channelStrips.length);
    });

    it('refuses to reorder when pads and channelStrips have diverged in length', () => {
        // Force a desynced invariant: more pads than strips. A blind splice/assert
        // would shift only one array; the guard must leave state untouched instead.
        padStore.update((s) => {
            const current = s ?? {};
            const inst = current[INSTANCE];
            if (!inst) {
                return current;
            }
            return {
                ...current,
                [INSTANCE]: { ...inst, channelStrips: inst.channelStrips.slice(0, -1) },
            };
        });
        const before = readInstance();

        reorderPad(INSTANCE, 0, 2);

        const after = readInstance();
        expect(after.pads).toBe(before.pads);
        expect(after.channelStrips).toBe(before.channelStrips);
    });

    it('ignores an out-of-bounds index without mutating state', () => {
        const before = readInstance();

        reorderPad(INSTANCE, 0, DEFAULT_PAD_COUNT + 5);

        const after = readInstance();
        expect(after).toBe(before);
    });
});
