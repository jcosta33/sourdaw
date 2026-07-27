export function linkCloudRequestAbort(
    callerSignal: AbortSignal | undefined,
    requestController: AbortController
): () => void {
    if (!callerSignal) {
        return () => undefined;
    }
    const signal = callerSignal;

    function abortRequest() {
        requestController.abort(signal.reason);
    }
    if (signal.aborted) {
        abortRequest();
        return () => undefined;
    }

    signal.addEventListener('abort', abortRequest, { once: true });
    return () => signal.removeEventListener('abort', abortRequest);
}
