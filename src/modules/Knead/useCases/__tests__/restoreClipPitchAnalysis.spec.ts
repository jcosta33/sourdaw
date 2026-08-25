import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type Clip, updateClipInStore } from '#/modules/Arrangement/stores';
import { type KneadPitchBlobSnapshot, type PitchContourSnapshot } from '#/utils/handlerContract';

import { defaultKneadState, kneadStore, type KneadClipState } from '../../stores/kneadStore';
import { restoreClipPitchAnalysis } from '../restoreClipPitchAnalysis';

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Arrangement/stores')>();
    return { ...actual, updateClipInStore: vi.fn() };
});

function baseClip(): Clip {
    return {
        id: 'clip-1',
        trackId: 'track-1',
        name: 'Take',
        startBeat: 0,
        endBeat: 4,
        type: 'audio',
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '#ffffff',
        locked: false,
        muted: false,
    };
}

function contour(): PitchContourSnapshot {
    return {
        points: [{ time_ms: 0, frequency_hz: 220, confidence: 0.9, voiced: true }],
        sample_rate: 48000,
        hop_size: 256,
    };
}

function blobSnapshot(): KneadPitchBlobSnapshot {
    return {
        id: 'blob-1',
        startTime: 0.1,
        endTime: 0.5,
        pitchCenterCents: 6300,
        originalPitchCenterCents: 6000,
        pitchCurveCents: [],
        voicedConfidence: 0.9,
        driftPercent: 5,
        vibratoDepthPercent: 0,
        vibratoRateHz: 0,
        formantShiftCents: 0,
        gainDb: 0,
        muted: false,
    };
}

function seededClipState(): KneadClipState {
    return {
        clipId: 'clip-1',
        blobs: [],
        retuneSpeedMs: 25,
        toleranceCents: 25,
        toleranceTimeMs: 30,
        humanizePercent: 40,
        formantPreserve: true,
    };
}

/** Applies the real `updateClipInStore` updater closure to a base clip and
 * returns the clip the persisting write would land on. */
function persistedClipFrom(write: () => void): Clip {
    let persisted: Clip | undefined;
    vi.mocked(updateClipInStore).mockImplementation((_clipId: string, updater: (clip: Clip) => Clip) => {
        persisted = updater(baseClip());
        return true;
    });

    write();

    return persisted!;
}

// The clip's own `kneadState` is what persistence and collaboration read, and it
// carries only the keys `ClipKneadState` declares (#2571) — the store-shaped
// state restore rebuilds must be projected down, not mirrored raw.
describe('restoreClipPitchAnalysis', () => {
    beforeEach(() => {
        vi.mocked(updateClipInStore).mockReset();
        kneadStore.set({ ...defaultKneadState, clips: { 'clip-1': seededClipState() } });
    });

    it('restores blobs into the knead store', () => {
        restoreClipPitchAnalysis('clip-1', { blobs: [blobSnapshot()], contour: contour() });

        const storeState = kneadStore.value?.clips['clip-1'];
        expect(storeState?.blobs).toHaveLength(1);
        expect(storeState?.blobs[0]?.driftPercent).toBe(5);
        expect(kneadStore.value?.contours['clip-1']).toEqual(contour());
    });

    it('mirrors the restored analysis onto the clip as the declared ClipKneadState shape', () => {
        const persisted = persistedClipFrom(() =>
            restoreClipPitchAnalysis('clip-1', { blobs: [blobSnapshot()], contour: contour() })
        );

        const kneadState = persisted.kneadState!;
        expect(Object.keys(kneadState).sort()).toEqual([
            'blobs',
            'formantPreserve',
            'humanizePercent',
            'retuneSpeedMs',
        ]);
        const firstBlob = kneadState.blobs[0]!;
        expect(Object.keys(firstBlob).sort()).toEqual([
            'endTime',
            'id',
            'originalPitchCenterCents',
            'pitchCenterCents',
            'pitchCurveCents',
            'startTime',
            'voicedConfidence',
        ]);
    });
});
