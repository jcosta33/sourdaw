import { isTauri, tauriListen } from '#/utils/tauriBridge';

type ListenPitchAnalysisProgressInput = {
    analysisId: string;
    onProgress: (progress: number) => void;
};

type AnalysisProgress = {
    analysisId: string;
    progress: number;
};

type ListenPitchAnalysisProgressOutput = Promise<(() => void) | null>;

export async function listenPitchAnalysisProgress({
    analysisId,
    onProgress,
}: ListenPitchAnalysisProgressInput): ListenPitchAnalysisProgressOutput {
    if (!isTauri()) {
        return null;
    }

    return tauriListen('pitch-analysis-progress', (envelope) => {
        const { payload } = envelope as { payload: AnalysisProgress };
        if (payload.analysisId !== analysisId) {
            return;
        }

        onProgress(payload.progress);
    });
}
