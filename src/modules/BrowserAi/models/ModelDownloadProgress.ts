/**
 * Pure data shape for a browser-model download lifecycle. Shared by the download
 * use case, the repository download manager (IO edge), and the event contract that
 * re-exports it. Kept in models/ so repositories/ can consume it without importing
 * from events/ (repositories-no-business boundary).
 */
export type ModelDownloadProgressPayload = {
    modelId: string;
    bytesDownloaded: number;
    totalBytes: number;
    /** 0–1 */
    progress: number;
    stage: 'downloading' | 'verifying' | 'extracting' | 'storing' | 'complete' | 'error';
    error?: string;
};
