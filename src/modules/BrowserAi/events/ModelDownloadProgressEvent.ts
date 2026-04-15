export type ModelDownloadProgressPayload = {
    modelId: string;
    bytesDownloaded: number;
    totalBytes: number;
    /** 0–1 */
    progress: number;
    stage: 'downloading' | 'verifying' | 'extracting' | 'storing' | 'complete' | 'error';
    error?: string;
};
