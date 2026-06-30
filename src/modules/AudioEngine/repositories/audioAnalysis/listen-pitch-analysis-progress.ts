import { isTauri } from '#/utils/tauriBridge';

type ListenPitchAnalysisProgressInput = {
    onProgress: (progress: number) => void;
};

type AnalysisProgress = {
    progress: number;
};

type ListenPitchAnalysisProgressOutput = Promise<(() => void) | null>;

export async function listenPitchAnalysisProgress({
    onProgress,
}: ListenPitchAnalysisProgressInput): ListenPitchAnalysisProgressOutput {
    if (!isTauri()) {
        return null;
    }

    const { listen } = await import('@tauri-apps/api/event');
    return listen<AnalysisProgress>('pitch-analysis-progress', (event) => {
        onProgress(event.payload.progress);
    });
}
