import { describe, it, expect, vi, beforeEach } from 'vitest';

const armRecording = vi.hoisted(() =>
    vi.fn<typeof import('../../../repositories/crumbsBridge/armRecording').armRecording>(() => Promise.resolve())
);
const startCrumbsRecordFeed = vi.hoisted(() => vi.fn());

vi.mock('../../../repositories/crumbsBridge/armRecording', () => ({
    armRecording,
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    startCrumbsRecordFeed,
}));

import { padStore, ensurePadInstance } from '../../../stores/padStore';
import { armCrumbsRecording } from '../armCrumbsRecording';

const INSTANCE = 'inst-A';

describe('armCrumbsRecording parameter validation', () => {
    beforeEach(() => {
        armRecording.mockClear();
        startCrumbsRecordFeed.mockClear();
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

        // Reported as "not armed", not as a resolved arm: the caller renders
        // this outcome as recorder state, and a bare resolve is
        // indistinguishable from an open take.
        await expect(armCrumbsRecording(INSTANCE, 0.5, 0, 60)).resolves.toBe(false);

        expect(armRecording).not.toHaveBeenCalled();
    });

    it('reports an armed recorder only once the bridge accepted the arm', async () => {
        await expect(armCrumbsRecording(INSTANCE, 0.5, 0, 60)).resolves.toBe(true);
    });

    it('engages the monitored-input record feed once the native arm is accepted', async () => {
        // The native bridges have no other producer: an arm that does not
        // engage the feed records silence (#2231).
        await expect(armCrumbsRecording(INSTANCE, 0.5, 0, 60)).resolves.toBe(true);
        expect(startCrumbsRecordFeed).toHaveBeenCalledTimes(1);
        expect(startCrumbsRecordFeed).toHaveBeenCalledWith(INSTANCE);
    });

    it('does not engage the record feed for a refused arm', async () => {
        armRecording.mockRejectedValueOnce(new Error('Crumbs instance not found'));

        await expect(armCrumbsRecording(INSTANCE, 0.5, 0, 60)).rejects.toThrow('Crumbs instance not found');

        expect(startCrumbsRecordFeed).not.toHaveBeenCalled();
    });

    it('does not engage the record feed when there is nothing to arm', async () => {
        padStore.set({});

        await expect(armCrumbsRecording(INSTANCE, 0.5, 0, 60)).resolves.toBe(false);

        expect(startCrumbsRecordFeed).not.toHaveBeenCalled();
    });

    it('propagates a backend refusal instead of reporting an armed recorder', async () => {
        armRecording.mockRejectedValueOnce(new Error('Crumbs instance not found'));

        await expect(armCrumbsRecording(INSTANCE, 0.5, 0, 60)).rejects.toThrow('Crumbs instance not found');
    });

    it('forwards valid parameters unchanged', async () => {
        await armCrumbsRecording(INSTANCE, 0.25, 2, 45);

        expect(armRecording).toHaveBeenCalledWith(INSTANCE, 0.25, 2, 45);
    });
});
