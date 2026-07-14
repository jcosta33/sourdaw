import { isTauri } from '#/utils/tauriBridge';

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

    const { listen } = await import('@tauri-apps/api/event');
    return listen<AnalysisProgress>('pitch-analysis-progress', (event) => {
        if (event.payload.analysisId !== analysisId) {
            return;
        }

        onProgress(event.payload.progress);
    });
}
