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
        // The operation promise is created before this helper is called. It can
        // therefore reject even though cancellation wins synchronously here.
        // Observe that losing rejection so it cannot escape as an unhandled
        // promise while the caller receives the signal's abort reason.
        void promise.catch(() => {});
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
