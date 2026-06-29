type ListenPitchAnalysisProgressInput = {
    onProgress: (progress: number) => void;
};

type AnalysisProgress = {
    progress: number;
};

type ListenPitchAnalysisProgressOutput = Promise<() => void>;

export async function listenPitchAnalysisProgress({
    onProgress,
}: ListenPitchAnalysisProgressInput): ListenPitchAnalysisProgressOutput {
    const { listen } = await import('@tauri-apps/api/event');
    return listen<AnalysisProgress>('pitch-analysis-progress', (event) => {
        onProgress(event.payload.progress);
    });
}
