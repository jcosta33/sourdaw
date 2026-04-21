/**
 * Runs an offline render with a timeout guard to prevent stuck renders
 * from blocking the engine lock indefinitely.
 */
export function renderWithTimeout(offlineCtx: OfflineAudioContext, timeoutMs: number): Promise<AudioBuffer> {
    return new Promise<AudioBuffer>((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`Offline render timed out after ${timeoutMs / 1000}s`));
        }, timeoutMs);

        offlineCtx.startRendering().then(
            (buffer) => {
                clearTimeout(timer);
                resolve(buffer);
                return null;
            },
            (error: unknown) => {
                clearTimeout(timer);
                reject(error instanceof Error ? error : new Error(String(error)));
                return null;
            }
        );
    });
}
