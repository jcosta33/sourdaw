import { type NoteBlob } from '../stores/kneadStore';

import { updateTransientClipKneadState } from './updateTransientClipKneadState';

/**
 * Parses raw analysis frames from the Rust/WASM engine and converts them
 * into editable NoteBlobs.
 *
 * Aggressive Implementation:
 * - Contiguous voiced frames are grouped into "blobs".
 * - Unvoiced gaps up to MAX_GAP_FRAMES long are bridged unconditionally (no
 *   pitch comparison across the gap); a longer gap closes the current run.
 * - A bridged run is then split at note boundaries after the fact: a jump of
 *   one tempered semitone or more (>= PITCH_SPLIT_CENTS) between consecutive
 *   voiced frames starts a new blob (see finalizeBlob).
 * - Pitch center is calculated using confidence-weighted average.
 */
export function ingestDspAnalysis(
    clipId: string,
    frames: { time: number; f0: number | null; periodicity: number }[]
): void {
    const blobs: NoteBlob[] = [];
    const MIN_BLOB_FRAMES = 5;
    const MAX_GAP_FRAMES = 3;
    // A jump of one tempered semitone or more between consecutive voiced frames
    // marks a note boundary: it is a new pitch, not micro-pitch movement within
    // one note. The split test is `>=` so an exactly-one-semitone step counts.
    const PITCH_SPLIT_CENTS = 100;
    // Fallback hop used only when a run is too short to observe a cadence.
    const DEFAULT_HOP_SECONDS = 0.01;

    type PitchPoint = { cents: number; confidence: number; time: number };

    let currentPitchPoints: PitchPoint[] = [];
    let gapCounter = 0;

    /**
     * Estimates the analysis hop (seconds per frame) from a run's own
     * timestamps so the emitted interval covers the final frame's window
     * rather than ending one hop early. Uses the smallest positive gap, which
     * is the per-frame cadence even when a run bridges a voiced gap.
     */
    function estimateHopSeconds(points: PitchPoint[]): number {
        let hop = Infinity;
        for (let i = 1; i < points.length; i++) {
            const delta = points[i]!.time - points[i - 1]!.time;
            if (delta > 0 && delta < hop) {
                hop = delta;
            }
        }
        return Number.isFinite(hop) ? hop : DEFAULT_HOP_SECONDS;
    }

    function emitBlob(points: PitchPoint[]): void {
        if (points.length < MIN_BLOB_FRAMES) {
            return;
        }

        // Confidence-weighted average for pitch center
        let totalWeightedCents = 0;
        let totalConfidence = 0;
        for (const pt of points) {
            totalWeightedCents += pt.cents * pt.confidence;
            totalConfidence += pt.confidence;
        }

        // Guard against a zero (or negative) confidence sum: dividing by it
        // would yield NaN and poison pitchCenterCents. A run with no voiced
        // confidence has no meaningful pitch center, so drop it.
        if (totalConfidence <= 0) {
            return;
        }

        const avgCents = Math.round(totalWeightedCents / totalConfidence);
        const startTime = points[0]!.time;
        // The last frame covers a full hop of audio, so its interval ends one
        // hop after its timestamp. Ending at the timestamp itself would
        // deactivate a hop early at the tail of the blob.
        const endTime = points[points.length - 1]!.time + estimateHopSeconds(points);

        blobs.push({
            id: crypto.randomUUID(),
            startTime,
            endTime,
            pitchCenterCents: avgCents,
            originalPitchCenterCents: avgCents,
            pitchCurveCents: points.map((param) => Math.round(param.cents - avgCents)),
            voicedConfidence: totalConfidence / points.length,
            driftPercent: 0,
            vibratoDepthPercent: 0,
            vibratoRateHz: 0,
            formantShiftCents: 0,
            gainDb: 0,
            muted: false,
        });
    }

    function finalizeBlob() {
        // Split the run at note boundaries: a jump of one tempered semitone or
        // more between consecutive voiced frames is a new note, not a single
        // retunable region. Without this, a run spanning two pitches (possibly
        // bridged through a gap) would average to a pitch between them and the
        // worklet would apply one uniform shift across what were two notes.
        let segmentStart = 0;
        for (let i = 1; i < currentPitchPoints.length; i++) {
            const jump = Math.abs(currentPitchPoints[i]!.cents - currentPitchPoints[i - 1]!.cents);
            if (jump >= PITCH_SPLIT_CENTS) {
                emitBlob(currentPitchPoints.slice(segmentStart, i));
                segmentStart = i;
            }
        }
        emitBlob(currentPitchPoints.slice(segmentStart));

        currentPitchPoints = [];
        gapCounter = 0;
    }

    for (const frame of frames) {
        const isVoiced = frame.f0 !== null && frame.periodicity > 0.6;

        if (isVoiced) {
            const midiNote = 69 + 12 * Math.log2(frame.f0! / 440);
            currentPitchPoints.push({
                cents: midiNote * 100,
                confidence: frame.periodicity,
                time: frame.time,
            });
            gapCounter = 0;
        } else {
            if (currentPitchPoints.length > 0) {
                gapCounter++;
                if (gapCounter > MAX_GAP_FRAMES) {
                    finalizeBlob();
                }
            }
        }
    }

    finalizeBlob();

    // These blobs are derived from the clip's audio, not chosen by the musician,
    // so they take the transient path: Knead store only, never the clip's
    // persisted `kneadState`. Analysis fires the moment a clip is selected in
    // pitch mode; persisting here would author project state nobody chose (#2557).
    updateTransientClipKneadState(clipId, (state) => ({ ...state, blobs }));
}
