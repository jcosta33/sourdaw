import { describe, it, expect, vi, beforeEach } from 'vitest';

import { kneadStore, defaultKneadState } from '../../stores/kneadStore';
import { analyzeClipPitch } from '../analyzeClipPitch';

const { analyzePitchForClip } = vi.hoisted(() => ({ analyzePitchForClip: vi.fn() }));

// Mock the AudioEngine boundary: this orchestrator's job is to feed whatever
// contour the engine returns into ingestDspAnalysis. Knead -> AudioEngine is the
// safe direction, so we stub the engine call rather than run real analysis.
vi.mock('#/modules/AudioEngine/useCases', () => ({
    analyzePitchForClip,
}));

// updateClipKneadState (run for real below) also writes the Arrangement store;
// stub that side so the test stays focused on the Knead store.
vi.mock('#/modules/Arrangement/stores', () => ({
    updateClipInStore: vi.fn(),
}));

describe('analyzeClipPitch', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        kneadStore.set({ ...defaultKneadState, clips: {}, contours: {} });
    });

    it('populates editable blobs from the analysed contour so the editor is not stuck re-analysing', async () => {
        // Regression (relocated from analyzePitchForClip): the analysis pipeline
        // must convert the contour into editable NoteBlobs, otherwise `blobs`
        // stays empty and the editor overlay (gated on blobs.length === 0)
        // re-triggers analysis forever. A run of contiguous voiced frames
        // (>= MIN_BLOB_FRAMES) at a steady pitch finalises one blob.
        const voicedPoints = Array.from({ length: 8 }, (_, index) => ({
            time_ms: index * 10,
            frequency_hz: 440,
            confidence: 0.9,
            voiced: true,
        }));
        analyzePitchForClip.mockResolvedValue({
            status: 'analyzed',
            contour: { points: voicedPoints, sample_rate: 44100, hop_size: 256, algorithm: 'pyin' },
        });

        const outcome = await analyzeClipPitch('c1');

        expect(analyzePitchForClip).toHaveBeenCalledWith('c1');
        expect(outcome.status).toBe('analyzed');

        const clipState = kneadStore.value.clips.c1;
        expect(clipState).toBeDefined();
        expect(clipState?.blobs.length).toBeGreaterThan(0);
        // Each blob carries its pitch center so the worklet shift is well-defined.
        expect(clipState?.blobs[0]?.pitchCenterCents).toBeGreaterThan(0);
    });

    it('does not ingest blobs when the engine resolves a clip with no buffer', async () => {
        analyzePitchForClip.mockResolvedValue({
            status: 'no-buffer',
            reason: 'missing-clip-or-buffer',
        });

        const outcome = await analyzeClipPitch('c1');

        expect(outcome).toEqual({ status: 'no-buffer', reason: 'missing-clip-or-buffer' });
        expect(kneadStore.value.clips.c1).toBeUndefined();
    });
});
