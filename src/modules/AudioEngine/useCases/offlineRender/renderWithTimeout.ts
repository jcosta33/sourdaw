/**
 * Runs an offline render with a timeout guard.
 *
 * The guard rejects the returned promise after `timeoutMs` so a stuck render no
 * longer holds the caller's engine lock. It does NOT cancel the render itself:
 * the Web Audio OfflineAudioContext has no cancellation API, so on timeout the
 * underlying `startRendering()` keeps running to completion in the background
 * and its CPU is only reclaimed when that resolves. The guard frees the lock,
 * not the work.
 */
export function renderWithTimeout(offlineCtx: OfflineAudioContext, timeoutMs: number): Promise<AudioBuffer> {
    return new Promise<AudioBuffer>((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`Offline render timed out after ${timeoutMs / 1000}s`));
        }, timeoutMs);

        offlineCtx
            .startRendering()
            .then(
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
            )
            .catch(() => undefined);
    });
}
