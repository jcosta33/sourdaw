import { beforeEach, describe, expect, it, vi } from 'vitest';

import { updateClipInStore } from '#/modules/Arrangement/stores';

import {
    defaultKneadState,
    kneadStore,
    type KneadClipState,
    type NoteBlob,
    type PitchContour,
} from '../../stores/kneadStore';
import { clearClipPitchAnalysis } from '../clearClipPitchAnalysis';

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Arrangement/stores')>();
    return { ...actual, updateClipInStore: vi.fn() };
});

function contour(lastTimeMs: number): PitchContour {
    return {
        points: [
            { time_ms: 0, frequency_hz: 220, confidence: 0.9, voiced: true },
            { time_ms: lastTimeMs, frequency_hz: 220, confidence: 0.9, voiced: true },
        ],
        sample_rate: 48000,
        hop_size: 256,
    };
}

function blob(id: string): NoteBlob {
    return {
        id,
        startTime: 0,
        endTime: 0.5,
        pitchCenterCents: 6300,
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

function clipState(clipId: string, blobs: NoteBlob[]): KneadClipState {
    return {
        clipId,
        blobs,
        retuneSpeedMs: 25,
        toleranceCents: 25,
        toleranceTimeMs: 30,
        humanizePercent: 40,
        formantPreserve: true,
    };
}

describe('clearClipPitchAnalysis', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        kneadStore.set({
            ...defaultKneadState,
            contours: { 'clip-1': contour(300), 'clip-2': contour(500) },
            clips: {
                'clip-1': clipState('clip-1', [blob('a'), blob('b')]),
                'clip-2': clipState('clip-2', [blob('c')]),
            },
        });
    });

    // Contour and blobs are one analysis, and the editor's re-analysis gate closes on
    // either of them. Dropping only the contour leaves the blobs standing, holds the
    // gate shut, and — because blobs are CRDT-persisted — makes pitch editing one-shot
    // per clip, across reloads and for every collaborator.
    it('removes the contour and the blobs together for the given clip', () => {
        clearClipPitchAnalysis('clip-1');

        expect(kneadStore.value?.contours['clip-1']).toBeUndefined();
        expect(kneadStore.value?.clips['clip-1']?.blobs).toEqual([]);
    });

    it('keeps the analysis of every other clip', () => {
        clearClipPitchAnalysis('clip-1');

        expect(kneadStore.value?.contours['clip-2']).toEqual(contour(500));
        expect(kneadStore.value?.clips['clip-2']?.blobs.map((each) => each.id)).toEqual(['c']);
    });

    it('keeps the clip’s other Knead settings, clearing only what the analysis produced', () => {
        clearClipPitchAnalysis('clip-1');

        expect(kneadStore.value?.clips['clip-1']).toMatchObject({
            clipId: 'clip-1',
            retuneSpeedMs: 25,
            humanizePercent: 40,
            formantPreserve: true,
        });
    });

    // The clip's own `kneadState` is what persistence and collaboration read. A
    // Knead-store-only clear would come back on the next load.
    it('mirrors the cleared blobs onto the clip', () => {
        clearClipPitchAnalysis('clip-1');

        expect(updateClipInStore).toHaveBeenCalledWith('clip-1', expect.any(Function));
    });

    it('does not touch the clip when there were no blobs to clear', () => {
        kneadStore.set({ ...defaultKneadState, contours: { 'clip-1': contour(300) }, clips: {} });

        clearClipPitchAnalysis('clip-1');

        expect(kneadStore.value?.contours['clip-1']).toBeUndefined();
        expect(updateClipInStore).not.toHaveBeenCalled();
    });

    it('is a no-op when the clip has neither contour nor blobs', () => {
        const before = kneadStore.value;

        clearClipPitchAnalysis('clip-unknown');

        expect(kneadStore.value).toBe(before);
        expect(kneadStore.value?.contours['clip-1']).toEqual(contour(300));
    });

    it('is a no-op when the store is uninitialized', () => {
        kneadStore.set(null);

        expect(() => clearClipPitchAnalysis('clip-1')).not.toThrow();
        expect(kneadStore.value).toBeNull();
    });
});
