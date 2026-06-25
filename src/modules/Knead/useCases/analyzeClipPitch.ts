import { analyzePitchForClip } from '#/modules/AudioEngine/useCases';

import { ingestDspAnalysis } from './dspAnalysis';

type AnalyzeOutcome = Awaited<ReturnType<typeof analyzePitchForClip>>;

/**
 * Knead-side orchestrator for offline pitch analysis.
 *
 * Runs the AudioEngine's offline pitch analysis for a clip and, when it
 * produces a contour, feeds that contour into `ingestDspAnalysis` so the
 * editor's editable NoteBlob layer populates. Without this the analysis only
 * ever filled `contours[clipId]` and `blobs` stayed empty, leaving the editor
 * stuck re-triggering analysis.
 *
 * Ingestion lives here, on the Knead side, rather than inside
 * `analyzePitchForClip`: blob ingestion is Knead's responsibility, and keeping
 * the call here means AudioEngine never imports the Knead use-case barrel —
 * which would close an `AudioEngine → Knead → AudioEngine` cycle. Knead →
 * AudioEngine is the existing safe direction (see `syncKneadToEngine`).
 */
export async function analyzeClipPitch(clipId: string): Promise<AnalyzeOutcome> {
    const outcome = await analyzePitchForClip(clipId);

    if (outcome.status === 'analyzed') {
        ingestDspAnalysis(
            clipId,
            outcome.contour.points.map((point) => ({
                time: point.time_ms / 1000,
                f0: point.voiced ? point.frequency_hz : null,
                periodicity: point.confidence,
            }))
        );
    }

    return outcome;
}
