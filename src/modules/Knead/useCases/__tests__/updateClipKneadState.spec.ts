import { beforeEach, describe, expect, it, vi } from 'vitest';

import { kneadStore, defaultKneadState, type KneadClipState } from '../../stores/kneadStore';
import { updateClipKneadState } from '../updateClipKneadState';

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
});
