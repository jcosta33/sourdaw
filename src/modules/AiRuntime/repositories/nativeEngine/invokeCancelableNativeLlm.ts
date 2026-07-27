import { tauriInvoke } from '#/utils/tauriBridge';

type InvokeCancelableNativeLlmInput = {
    command: string;
    args: Record<string, unknown>;
    signal?: AbortSignal;
    timeoutMs?: number;
    abortMessage: string;
    timeoutMessage?: string;
    requestId?: string;
};

export async function invokeCancelableNativeLlm(input: InvokeCancelableNativeLlmInput): Promise<unknown> {
    input.signal?.throwIfAborted();

    const requestId = input.requestId ?? crypto.randomUUID();
    const invocation = tauriInvoke(input.command, {
        ...input.args,
        requestId,
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;

    function cancelNativeGeneration(): void {
        void tauriInvoke('cancel_native_llm_generation', { requestId }).catch(() => undefined);
    }

    const guard = new Promise<never>((_resolve, reject) => {
        if (input.timeoutMs !== undefined) {
            timer = setTimeout(() => {
                cancelNativeGeneration();
                reject(
                    new Error(input.timeoutMessage ?? `Native inference timed out after ${String(input.timeoutMs)}ms`)
                );
            }, input.timeoutMs);
        }

        if (input.signal) {
            onAbort = () => {
                cancelNativeGeneration();
                const error = new Error(input.abortMessage);
                error.name = 'AbortError';
                reject(error);
            };
            input.signal.addEventListener('abort', onAbort, { once: true });
        }
    });

    try {
        return await Promise.race([invocation, guard]);
    } finally {
        if (timer !== undefined) {
            clearTimeout(timer);
        }
        if (input.signal && onAbort) {
            input.signal.removeEventListener('abort', onAbort);
        }
    }
}
