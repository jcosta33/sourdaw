import { type NoteBlob, updateTrackKneadState } from '../stores/kneadStore';

/**
 * Parses raw analysis frames from the Rust/WASM engine and converts them
 * into editable NoteBlobs. This handles segmentation and drift calculation.
 */
export function ingestDspAnalysis(
    trackId: string,
    frames: { time: number; f0: number | null; periodicity: number }[]
): void {
    // Placeholder logic for MVP mapping pitch frames to discrete NoteBlobs
    const blobs: NoteBlob[] = [];

    // Simulate finding a contiguous voiced region for now
    let currentBlob: Partial<NoteBlob> | null = null;
    let pitchPoints: number[] = [];

    for (const frame of frames) {
        if (frame.f0 !== null && frame.periodicity > 0.7) {
            if (!currentBlob) {
                currentBlob = {
                    id: crypto.randomUUID(),
                    startTime: frame.time,
                    voicedConfidence: frame.periodicity,
                    vibratoDepthPercent: 0,
                    vibratoRateHz: 0,
                    driftPercent: 0,
                    formantShiftCents: 0,
                    gainDb: 0,
                    muted: false,
                };
            }
            // Convert to cents (A4 = 440 = 69 * 100 = 6900 cents)
            const midiNote = 69 + 12 * Math.log2(frame.f0 / 440);
            pitchPoints.push(midiNote * 100);
            currentBlob.endTime = frame.time;
        } else {
            if (currentBlob && pitchPoints.length > 5) {
                // Determine center by average
                const center = pitchPoints.reduce((a, b) => a + b, 0) / pitchPoints.length;
                currentBlob.pitchCenterCents = Math.round(center);
                // Center curve
                currentBlob.pitchCurveCents = pitchPoints.map((p) => p - currentBlob!.pitchCenterCents!);
                blobs.push(currentBlob as NoteBlob);
            }
            currentBlob = null;
            pitchPoints = [];
        }
    }

    if (currentBlob && pitchPoints.length > 5) {
        const center = pitchPoints.reduce((a, b) => a + b, 0) / pitchPoints.length;
        currentBlob.pitchCenterCents = Math.round(center);
        currentBlob.pitchCurveCents = pitchPoints.map((p) => p - currentBlob!.pitchCenterCents!);
        blobs.push(currentBlob as NoteBlob);
    }

    updateTrackKneadState(trackId, (state) => ({ ...state, blobs }));
}
