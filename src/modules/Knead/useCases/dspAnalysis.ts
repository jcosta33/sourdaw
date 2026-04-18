import { type NoteBlob, updateClipKneadState } from '../stores/kneadStore';

/**
 * Parses raw analysis frames from the Rust/WASM engine and converts them
 * into editable NoteBlobs. 
 * 
 * Aggressive Implementation:
 * - Contiguous voiced frames are grouped into "blobs".
 * - Small gaps (e.g. < 50ms) are bridged if pitch is stable.
 * - Pitch center is calculated using confidence-weighted average.
 */
export function ingestDspAnalysis(
    clipId: string,
    frames: { time: number; f0: number | null; periodicity: number }[]
): void {
    const blobs: NoteBlob[] = [];
    const MIN_BLOB_FRAMES = 5;
    const MAX_GAP_FRAMES = 3;

    let currentPitchPoints: { cents: number; confidence: number; time: number }[] = [];
    let gapCounter = 0;

    const finalizeBlob = () => {
        if (currentPitchPoints.length < MIN_BLOB_FRAMES) {
            currentPitchPoints = [];
            gapCounter = 0;
            return;
        }

        // Confidence-weighted average for pitch center
        let totalWeightedCents = 0;
        let totalConfidence = 0;
        for (const pt of currentPitchPoints) {
            totalWeightedCents += pt.cents * pt.confidence;
            totalConfidence += pt.confidence;
        }

        const avgCents = Math.round(totalWeightedCents / totalConfidence);
        const startTime = currentPitchPoints[0]!.time;
        const endTime = currentPitchPoints[currentPitchPoints.length - 1]!.time;

        blobs.push({
            id: crypto.randomUUID(),
            startTime,
            endTime,
            pitchCenterCents: avgCents,
            originalPitchCenterCents: avgCents,
            pitchCurveCents: currentPitchPoints.map((p) => Math.round(p.cents - avgCents)),
            voicedConfidence: totalConfidence / currentPitchPoints.length,
            driftPercent: 0,
            vibratoDepthPercent: 0,
            vibratoRateHz: 0,
            formantShiftCents: 0,
            gainDb: 0,
            muted: false,
        });

        currentPitchPoints = [];
        gapCounter = 0;
    };

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

    updateClipKneadState(clipId, (state) => ({ ...state, blobs }));
}
