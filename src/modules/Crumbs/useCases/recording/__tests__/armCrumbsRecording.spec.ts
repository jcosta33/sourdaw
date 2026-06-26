import { describe, it, expect, vi, beforeEach } from 'vitest';

const armRecording = vi.hoisted(() =>
    vi.fn<typeof import('../../../repositories/crumbsBridge').armRecording>(() => Promise.resolve())
);

vi.mock('../../../repositories/crumbsBridge', () => ({
    armRecording,
}));

import { padStore, ensurePadInstance } from '../../../stores/padStore';
import { armCrumbsRecording } from '../armCrumbsRecording';

const INSTANCE = 'inst-A';

describe('armCrumbsRecording parameter validation', () => {
    beforeEach(() => {
        armRecording.mockClear();
        padStore.set({});
        ensurePadInstance(INSTANCE);
    });

    it('clamps a targetPad past the last pad to the highest valid index', async () => {
        const padCount = padStore.value?.[INSTANCE]?.pads.length ?? 0;
        expect(padCount).toBeGreaterThan(0);

        // A targetPad of 999 is silently accepted by serde and rejected on the Rust
        // side with no UI feedback; the use case must clamp it to padCount - 1.
        await armCrumbsRecording(INSTANCE, 0.5, 999, 60);

        expect(armRecording).toHaveBeenCalledTimes(1);
        const [, , targetPad] = armRecording.mock.calls[0]!;
        expect(targetPad).toBe(padCount - 1);
    });

    it('clamps a negative targetPad to 0', async () => {
        await armCrumbsRecording(INSTANCE, 0.5, -3, 60);

        const [, , targetPad] = armRecording.mock.calls[0]!;
        expect(targetPad).toBe(0);
    });

    it('clamps an over-range threshold into 0..1', async () => {
        await armCrumbsRecording(INSTANCE, 5, 0, 60);

        const [, threshold] = armRecording.mock.calls[0]!;
        expect(threshold).toBe(1);
    });

    it('clamps a negative threshold to 0', async () => {
        await armCrumbsRecording(INSTANCE, -0.5, 0, 60);

        const [, threshold] = armRecording.mock.calls[0]!;
        expect(threshold).toBe(0);
    });

    it('replaces a non-positive maxDurationSecs with a positive default', async () => {
        await armCrumbsRecording(INSTANCE, 0.5, 0, 0);

        const [, , , maxDuration] = armRecording.mock.calls[0]!;
        expect(maxDuration).toBeGreaterThan(0);
    });

    it('does not arm when the instance has no pads', async () => {
        padStore.set({});

        await armCrumbsRecording(INSTANCE, 0.5, 0, 60);

        expect(armRecording).not.toHaveBeenCalled();
    });

    it('forwards valid parameters unchanged', async () => {
        await armCrumbsRecording(INSTANCE, 0.25, 2, 45);

        expect(armRecording).toHaveBeenCalledWith(INSTANCE, 0.25, 2, 45);
    });
});
