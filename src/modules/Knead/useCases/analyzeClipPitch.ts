import { analyzePitchForClip } from '#/modules/AudioEngine/useCases';

import { kneadStore } from '../stores/kneadStore';

import { ingestDspAnalysis } from './dspAnalysis';

type AnalyzeOutcome = Awaited<ReturnType<typeof analyzePitchForClip>>;

let nextAnalysisRunId = 0;
let latestStartedRunId = 0;
let latestStartedRunProgress = 0;
const activeAnalysisProgress = new Map<number, number>();
const latestAnalysisRunByClip = new Map<string, number>();

function getNewestActiveProgress(): number | null {
    let newestRunId = -1;
    let newestProgress: number | null = null;

    for (const [runId, progress] of activeAnalysisProgress) {
        if (runId > newestRunId) {
            newestRunId = runId;
            newestProgress = progress;
        }
    }

    return newestProgress;
}

function publishAnalysisState(): void {
    const state = kneadStore.value;
    if (!state) {
        return;
    }

    const activeProgress = getNewestActiveProgress();
    kneadStore.set({
        ...state,
        isAnalyzing: activeProgress !== null,
        analysisProgress: activeProgress ?? latestStartedRunProgress,
    });
}

/**
 * Knead-side orchestrator for offline pitch analysis.
 *
 * Owns the editor's analysis state and turns each current AudioEngine contour
 * into the raw trace and editable NoteBlobs needed by the editor.
 */
export async function analyzeClipPitch(clipId: string): Promise<AnalyzeOutcome> {
    const runId = ++nextAnalysisRunId;
    latestAnalysisRunByClip.set(clipId, runId);

    let didAnalyze = false;

    try {
        const outcome = await analyzePitchForClip({
            clipId,
            onStart: () => {
                latestStartedRunId = runId;
                latestStartedRunProgress = 0;
                activeAnalysisProgress.set(runId, 0);
                publishAnalysisState();
            },
            onProgress: (progress) => {
                if (!activeAnalysisProgress.has(runId)) {
                    return;
                }

                activeAnalysisProgress.set(runId, progress);
                publishAnalysisState();
            },
        });

        if (outcome.status === 'analyzed') {
            didAnalyze = true;

            if (latestAnalysisRunByClip.get(clipId) === runId) {
                const contourState = kneadStore.value;
                if (contourState) {
                    kneadStore.set({
                        ...contourState,
                        contours: {
                            ...contourState.contours,
                            [clipId]: outcome.contour,
                        },
                    });
                }

                ingestDspAnalysis(
                    clipId,
                    outcome.contour.points.map((point) => ({
                        time: point.time_ms / 1000,
                        f0: point.voiced ? point.frequency_hz : null,
                        periodicity: point.confidence,
                    }))
                );
            }
        }

        return outcome;
    } finally {
        if (latestAnalysisRunByClip.get(clipId) === runId) {
            latestAnalysisRunByClip.delete(clipId);
        }

        if (activeAnalysisProgress.has(runId)) {
            activeAnalysisProgress.delete(runId);
            if (runId === latestStartedRunId) {
                latestStartedRunProgress = didAnalyze ? 1 : 0;
            }
            publishAnalysisState();
        }
    }
}
