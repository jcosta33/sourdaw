/** Reject an in-flight initialization await when its owning device load is cancelled. */
export async function raceAbortSignal<Value>(promise: Promise<Value>, signal?: AbortSignal): Promise<Value> {
    if (!signal) {
        return await promise;
    }

    const abortReason = (): Error => {
        if (signal.reason instanceof Error) {
            return signal.reason;
        }
        return new DOMException('Device initialization aborted', 'AbortError');
    };

    if (signal.aborted) {
        throw abortReason();
    }

    const aborted = Promise.withResolvers<never>();
    const handleAbort = (): void => aborted.reject(abortReason());
    signal.addEventListener('abort', handleAbort, { once: true });
    try {
        return await Promise.race([promise, aborted.promise]);
    } finally {
        signal.removeEventListener('abort', handleAbort);
    }
}
