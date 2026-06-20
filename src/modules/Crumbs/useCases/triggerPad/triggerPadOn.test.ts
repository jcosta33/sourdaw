import { describe, it, expect, vi, beforeEach } from 'vitest';

const crumbsNoteOn = vi.hoisted(() =>
    vi.fn<typeof import('../../repositories/crumbsBridge').crumbsNoteOn>(() => Promise.resolve())
);

vi.mock('../../repositories/crumbsBridge', () => ({
    crumbsNoteOn,
}));

import { padStore, ensurePadInstance } from '../../stores/padStore';

import { triggerPadOn } from './triggerPadOn';

const INSTANCE = 'inst-A';

describe('triggerPadOn velocity clamp', () => {
    beforeEach(() => {
        crumbsNoteOn.mockClear();
        padStore.set({});
        ensurePadInstance(INSTANCE);
    });

    it('clamps an out-of-range velocity down to the MIDI max of 127', async () => {
        // 200 is a valid JS number and a valid serde u8 up to 255 — without a clamp
        // it would pass straight through to the engine as an over-range velocity.
        await triggerPadOn(INSTANCE, 0, 200);

        expect(crumbsNoteOn).toHaveBeenCalledTimes(1);
        const [, , velocity] = crumbsNoteOn.mock.calls[0]!;
        expect(velocity).toBe(127);
    });

    it('clamps a negative velocity up to 0', async () => {
        await triggerPadOn(INSTANCE, 0, -5);

        const [, , velocity] = crumbsNoteOn.mock.calls[0]!;
        expect(velocity).toBe(0);
    });

    it('rounds a fractional velocity to an integer', async () => {
        await triggerPadOn(INSTANCE, 0, 63.7);

        const [, , velocity] = crumbsNoteOn.mock.calls[0]!;
        expect(velocity).toBe(64);
    });

    it('collapses a non-finite velocity to 0 rather than forwarding NaN', async () => {
        await triggerPadOn(INSTANCE, 0, Number.NaN);

        const [, , velocity] = crumbsNoteOn.mock.calls[0]!;
        expect(velocity).toBe(0);
    });

    it('forwards an in-range velocity unchanged', async () => {
        await triggerPadOn(INSTANCE, 0, 100);

        const [, , velocity] = crumbsNoteOn.mock.calls[0]!;
        expect(velocity).toBe(100);
    });
});
