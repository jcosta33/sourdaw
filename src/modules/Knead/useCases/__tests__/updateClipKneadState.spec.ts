import { beforeEach, describe, expect, it, vi } from 'vitest';

import { kneadStore, defaultKneadState, type KneadClipState } from '../../stores/kneadStore';
import { updateClipKneadState } from '../updateClipKneadState';
import { updateTransientClipKneadState } from '../updateTransientClipKneadState';

const { updateClipInStore } = vi.hoisted(() => ({ updateClipInStore: vi.fn() }));

vi.mock('#/modules/Arrangement/stores', () => ({
    updateClipInStore,
}));

function clipState(clipId: string): KneadClipState {
    return {
        clipId,
        blobs: [],
        retuneSpeedMs: 25,
        toleranceCents: 25,
        toleranceTimeMs: 30,
        humanizePercent: 40,
        formantPreserve: true,
    };
}

function blob() {
    return {
        id: 'blob-1',
        startTime: 0.1,
        endTime: 0.5,
        pitchCenterCents: 6000,
        originalPitchCenterCents: 6000,
        pitchCurveCents: [],
        voicedConfidence: 0.9,
        driftPercent: 0,
        vibratoDepthPercent: 0,
        vibratoRateHz: 0,
        formantShiftCents: 0,
        gainDb: 0,
        muted: false,
    };
}

describe('updateClipKneadState', () => {
    beforeEach(() => {
        updateClipInStore.mockClear();
        kneadStore.set({ ...defaultKneadState, clips: {} });
    });

    it('does not seed or write when the updater returns the same reference (read-only)', () => {
        updateClipKneadState('clip-1', (state) => state);

        // No magic-number default state should be seeded for a clip that had none.
        expect(kneadStore.value?.clips['clip-1']).toBeUndefined();
        // No downstream clip-store write means no engine re-sync is triggered.
        expect(updateClipInStore).not.toHaveBeenCalled();
    });

    it('does not write when an updater returns its existing-state argument unchanged', () => {
        kneadStore.set({ ...defaultKneadState, clips: { 'clip-1': clipState('clip-1') } });
        const before = kneadStore.value?.clips['clip-1'];
        updateClipInStore.mockClear();

        updateClipKneadState('clip-1', (state) => state);

        expect(kneadStore.value?.clips['clip-1']).toBe(before);
        expect(updateClipInStore).not.toHaveBeenCalled();
    });

    it('writes through both stores when the updater returns a changed state', () => {
        updateClipKneadState('clip-1', (state) => ({ ...state, retuneSpeedMs: 100 }));

        expect(kneadStore.value?.clips['clip-1']?.retuneSpeedMs).toBe(100);
        expect(updateClipInStore).toHaveBeenCalledTimes(1);
        expect(updateClipInStore).toHaveBeenCalledWith('clip-1', expect.any(Function));
    });

    it('does nothing when the knead store has no value', () => {
        kneadStore.set(null);

        updateClipKneadState('clip-1', (state) => ({ ...state, retuneSpeedMs: 999 }));

        expect(updateClipInStore).not.toHaveBeenCalled();
    });

    it('merges the next knead state into the arrangement clip through the updateClipInStore callback', () => {
        updateClipInStore.mockImplementation((_clipId: string, updater: (clip: { fileId: string }) => unknown) =>
            updater({ fileId: 'file-1' })
        );

        updateClipKneadState('clip-1', (state) => ({ ...state, retuneSpeedMs: 100 }));

        const merged = updateClipInStore.mock.results[0]?.value as {
            fileId: string;
            kneadState: KneadClipState;
        };
        expect(merged.fileId).toBe('file-1');
        expect(merged.kneadState.retuneSpeedMs).toBe(100);
    });

    // Regression (#2557): a clip whose knead state already exists — persisted by
    // an earlier edit and hydrated back — must keep persisting every further
    // edit; the transient path added for automatic analysis is a sibling, not a
    // replacement, for the user-edit route.
    it('still persists an edit for a clip that already carries knead state, blobs included (#2557)', () => {
        kneadStore.set({
            ...defaultKneadState,
            clips: { 'clip-1': { ...clipState('clip-1'), blobs: [blob()] } },
        });
        updateClipInStore.mockImplementation((_clipId: string, updater: (clip: { fileId: string }) => unknown) =>
            updater({ fileId: 'file-1' })
        );

        updateClipKneadState('clip-1', (state) => ({ ...state, humanizePercent: 70 }));

        expect(updateClipInStore).toHaveBeenCalledTimes(1);
        const merged = updateClipInStore.mock.results[0]?.value as {
            kneadState: KneadClipState;
        };
        expect(merged.kneadState.humanizePercent).toBe(70);
        expect(merged.kneadState.blobs).toHaveLength(1);
    });
});

describe('updateTransientClipKneadState', () => {
    beforeEach(() => {
        updateClipInStore.mockClear();
        kneadStore.set({ ...defaultKneadState, clips: {} });
    });

    it('publishes blobs and seeded defaults to the knead store without authoring the persisted clip (#2557)', () => {
        updateTransientClipKneadState('clip-1', (state) => ({ ...state, blobs: [blob()] }));

        // The editor reads this state: blobs render, and the settings controls
        // show the seeded defaults exactly as they did before the split.
        const published = kneadStore.value?.clips['clip-1'];
        expect(published?.blobs).toHaveLength(1);
        expect(published?.retuneSpeedMs).toBe(25);
        expect(published?.humanizePercent).toBe(40);
        expect(published?.formantPreserve).toBe(true);
        // The persisted clip is never written by the derived path.
        expect(updateClipInStore).not.toHaveBeenCalled();
    });

    it('does not seed or write when the updater returns the same reference (read-only)', () => {
        updateTransientClipKneadState('clip-1', (state) => state);

        expect(kneadStore.value?.clips['clip-1']).toBeUndefined();
        expect(updateClipInStore).not.toHaveBeenCalled();
    });

    it('does nothing when the knead store has no value', () => {
        kneadStore.set(null);

        updateTransientClipKneadState('clip-1', (state) => ({ ...state, blobs: [blob()] }));

        expect(updateClipInStore).not.toHaveBeenCalled();
    });
});
