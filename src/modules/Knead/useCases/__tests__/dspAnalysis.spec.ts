import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../updateClipKneadState', () => ({
    updateClipKneadState: vi.fn(),
}));
vi.mock('../updateTransientClipKneadState', () => ({
    updateTransientClipKneadState: vi.fn(),
}));

import { ingestDspAnalysis } from '../dspAnalysis';
import { updateClipKneadState } from '../updateClipKneadState';
import { updateTransientClipKneadState } from '../updateTransientClipKneadState';

describe('ingestDspAnalysis', () => {
    beforeEach(() => {
        vi.mocked(updateClipKneadState).mockClear();
        vi.mocked(updateTransientClipKneadState).mockClear();
    });

    it('writes empty blobs when no frames are voiced', () => {
        ingestDspAnalysis('c1', [
            { time: 0, f0: null, periodicity: 0 },
            { time: 0.01, f0: null, periodicity: 0 },
        ]);

        // Derived blobs take the transient path only; the persisting path is
        // reserved for real edits (#2557).
        expect(updateTransientClipKneadState).toHaveBeenCalledWith('c1', expect.any(Function));
        expect(updateClipKneadState).not.toHaveBeenCalled();
        const updater = vi.mocked(updateTransientClipKneadState).mock.calls[0]![1];
        const next = updater({ blobs: [] } as never);
        expect(next.blobs).toEqual([]);
    });

    it('emits a blob with averaged pitch center for a voiced region', () => {
        // 6 frames at A4 (440Hz) — exceeds the 5-frame threshold
        const frames = Array.from({ length: 6 }, (_, index) => ({
            time: index * 0.01,
            f0: 440,
            periodicity: 0.9,
        }));
        ingestDspAnalysis('c1', frames);

        const updater = vi.mocked(updateTransientClipKneadState).mock.calls[0]![1];
        const next = updater({ blobs: [] } as never);
        expect(next.blobs).toHaveLength(1);
        const blob = next.blobs[0]!;
        // 440Hz = MIDI 69 = 6900 cents
        expect(blob.pitchCenterCents).toBe(6900);
        expect(blob.startTime).toBe(0);
        // Last frame at 0.05 + one hop (0.01) so the final frame's window is
        // covered (see "extends endTime by one hop" test for the rationale).
        expect(blob.endTime).toBeCloseTo(0.06);
    });

    it('discards voiced regions shorter than 6 frames', () => {
        const frames = [
            { time: 0, f0: 440, periodicity: 0.9 },
            { time: 0.01, f0: 440, periodicity: 0.9 },
            { time: 0.02, f0: null, periodicity: 0 },
        ];
        ingestDspAnalysis('c1', frames);

        const updater = vi.mocked(updateTransientClipKneadState).mock.calls[0]![1];
        const next = updater({ blobs: [] } as never);
        expect(next.blobs).toEqual([]);
    });

    // Fix 1: the confidence-weighted divide must never produce NaN. The
    // voiced gate (periodicity > 0.6) keeps every stored confidence positive
    // today, so the totalConfidence<=0 branch is a *defensive* guard with no
    // input that reaches it through the current public surface. This test
    // therefore asserts the invariant the guard protects — no emitted blob
    // ever carries a NaN pitch center — across a realistic run sitting right
    // at the low end of the voiced confidence band. (Red/green for the guard
    // branch itself has no public seam; see report.)
    it('never emits a NaN pitch center across a low-confidence voiced run', () => {
        const frames = Array.from({ length: 6 }, (_, index) => ({
            time: index * 0.01,
            f0: 440,
            // Just above the 0.6 voiced gate — the smallest confidence the
            // pipeline can actually store for a voiced frame.
            periodicity: 0.61,
        }));
        ingestDspAnalysis('c1', frames);

        const updater = vi.mocked(updateTransientClipKneadState).mock.calls[0]![1];
        const next = updater({ blobs: [] } as never);
        expect(next.blobs).toHaveLength(1);
        for (const blob of next.blobs) {
            expect(Number.isNaN(blob.pitchCenterCents)).toBe(false);
            expect(Number.isFinite(blob.pitchCenterCents)).toBe(true);
        }
    });

    // Fix 2: a voiced run spanning two distinct pitches, bridged through a
    // gap within MAX_GAP_FRAMES, must split into two blobs — not average to a
    // pitch between them.
    it('splits a run spanning two pitches bridged through a short gap into two blobs', () => {
        const frames = [
            // Note A: 6 frames at 440Hz (MIDI 69 -> 6900 cents)
            { time: 0.0, f0: 440, periodicity: 0.9 },
            { time: 0.01, f0: 440, periodicity: 0.9 },
            { time: 0.02, f0: 440, periodicity: 0.9 },
            { time: 0.03, f0: 440, periodicity: 0.9 },
            { time: 0.04, f0: 440, periodicity: 0.9 },
            { time: 0.05, f0: 440, periodicity: 0.9 },
            // 2-frame unvoiced gap (within MAX_GAP_FRAMES=3, so the run bridges)
            { time: 0.06, f0: null, periodicity: 0 },
            { time: 0.07, f0: null, periodicity: 0 },
            // Note B: 6 frames at 880Hz (MIDI 81 -> 8100 cents, an octave up)
            { time: 0.08, f0: 880, periodicity: 0.9 },
            { time: 0.09, f0: 880, periodicity: 0.9 },
            { time: 0.1, f0: 880, periodicity: 0.9 },
            { time: 0.11, f0: 880, periodicity: 0.9 },
            { time: 0.12, f0: 880, periodicity: 0.9 },
            { time: 0.13, f0: 880, periodicity: 0.9 },
        ];
        ingestDspAnalysis('c1', frames);

        const updater = vi.mocked(updateTransientClipKneadState).mock.calls[0]![1];
        const next = updater({ blobs: [] } as never);
        expect(next.blobs).toHaveLength(2);
        const centers = next.blobs.map((b) => b.pitchCenterCents).sort((a, b) => a - b);
        expect(centers).toEqual([6900, 8100]);
        // Neither blob averaged to the midpoint (~7500 cents) between the notes.
        expect(centers).not.toContain(7500);
    });

    // Boundary fix: two adjacent notes exactly one tempered semitone apart
    // (440Hz -> 466.16Hz, a clean +100-cent step) must split into two blobs.
    // The split test is `>= PITCH_SPLIT_CENTS`; a strict `>` would merge them
    // and average to the 6950-cent midpoint.
    it('splits two notes exactly one tempered semitone apart', () => {
        // A4 = 440Hz (6900 cents); A#4 = 440 * 2^(1/12) ≈ 466.16Hz (7000 cents).
        const semitoneUp = 440 * 2 ** (1 / 12);
        const frames = [
            { time: 0.0, f0: 440, periodicity: 0.9 },
            { time: 0.01, f0: 440, periodicity: 0.9 },
            { time: 0.02, f0: 440, periodicity: 0.9 },
            { time: 0.03, f0: 440, periodicity: 0.9 },
            { time: 0.04, f0: 440, periodicity: 0.9 },
            { time: 0.05, f0: semitoneUp, periodicity: 0.9 },
            { time: 0.06, f0: semitoneUp, periodicity: 0.9 },
            { time: 0.07, f0: semitoneUp, periodicity: 0.9 },
            { time: 0.08, f0: semitoneUp, periodicity: 0.9 },
            { time: 0.09, f0: semitoneUp, periodicity: 0.9 },
        ];
        ingestDspAnalysis('c1', frames);

        const updater = vi.mocked(updateTransientClipKneadState).mock.calls[0]![1];
        const next = updater({ blobs: [] } as never);
        expect(next.blobs).toHaveLength(2);
        const centers = next.blobs.map((b) => b.pitchCenterCents).sort((a, b) => a - b);
        expect(centers).toEqual([6900, 7000]);
        // The two notes did not collapse into one blob averaged to the midpoint.
        expect(centers).not.toContain(6950);
    });

    // Fix 3: endTime must cover the final frame's hop window, not stop at the
    // last frame's timestamp (which would deactivate one hop early).
    it('extends endTime by one hop past the final voiced frame timestamp', () => {
        // 6 frames at 0.01s spacing: times 0.00 .. 0.05, hop = 0.01.
        const frames = Array.from({ length: 6 }, (_, index) => ({
            time: index * 0.01,
            f0: 440,
            periodicity: 0.9,
        }));
        ingestDspAnalysis('c1', frames);

        const updater = vi.mocked(updateTransientClipKneadState).mock.calls[0]![1];
        const next = updater({ blobs: [] } as never);
        expect(next.blobs).toHaveLength(1);
        const blob = next.blobs[0]!;
        // Last frame at 0.05 + one hop (0.01) = 0.06, covering its full window.
        expect(blob.endTime).toBeCloseTo(0.06);
    });
});
