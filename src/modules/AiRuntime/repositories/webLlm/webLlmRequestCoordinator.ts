import { type WebLlmEngine } from './engineLifecycleState';

type WebLlmRequestInput = {
    signal?: AbortSignal;
    execute: () => Promise<unknown>;
};

type WebLlmStreamInput<Chunk> = {
    signal?: AbortSignal;
    create: () => Promise<AsyncIterable<Chunk>>;
    consume: (chunk: Chunk) => void;
    onProviderFailure?: (error: WebLlmStreamProviderError) => void;
};

type PendingRequest = {
    signal?: AbortSignal;
    start: () => void;
    reject: (reason: unknown) => void;
    abort: () => void;
    removeAbortListener: () => void;
};

type ActiveRequest = {
    reject: (reason: unknown) => void;
    interrupt: () => void;
    markProviderDispatched: () => void;
};

type EngineAdmission = {
    active: ActiveRequest | null;
    pending: PendingRequest[];
    retired: Error | null;
};

const admissions = new WeakMap<WebLlmEngine, EngineAdmission>();

export class WebLlmStreamProviderError extends Error {
    constructor(cause: unknown) {
        super('WebLLM stream provider failed', { cause });
        this.name = 'WebLlmStreamProviderError';
    }
}

function createAbortError(signal: AbortSignal): Error {
    return signal.reason instanceof Error ? signal.reason : new DOMException('WebLLM request aborted', 'AbortError');
}

function toError(reason: unknown): Error {
    return reason instanceof Error ? reason : new Error(String(reason));
}

function providerFailure<Chunk>(input: WebLlmStreamInput<Chunk>, cause: unknown): WebLlmStreamProviderError {
    const error = new WebLlmStreamProviderError(cause);
    input.onProviderFailure?.(error);
    return error;
}

function getAdmission(engine: WebLlmEngine): EngineAdmission {
    const existing = admissions.get(engine);
    if (existing) {
        return existing;
    }
    const admission: EngineAdmission = { active: null, pending: [], retired: null };
    admissions.set(engine, admission);
    return admission;
}

function releaseActive(engine: WebLlmEngine, active: ActiveRequest): void {
    const admission = getAdmission(engine);
    if (admission.active !== active) {
        return;
    }
    admission.active = null;
    startNext(engine, admission);
}

function startNext(engine: WebLlmEngine, admission: EngineAdmission): void {
    if (admission.active || admission.retired !== null) {
        return;
    }
    const next = admission.pending.shift();
    if (!next) {
        return;
    }
    next.removeAbortListener();
    next.start();
}

function enqueuePending(admission: EngineAdmission, request: PendingRequest): void {
    admission.pending.push(request);
}

function createActiveRequest(engine: WebLlmEngine, reject: (reason: unknown) => void): ActiveRequest {
    let interruptRequested = false;
    let providerDispatched = false;
    let interrupted = false;
    return {
        reject,
        interrupt: () => {
            interruptRequested = true;
            if (providerDispatched && !interrupted) {
                interrupted = true;
                engine.interruptGenerate();
            }
        },
        markProviderDispatched: () => {
            providerDispatched = true;
            if (interruptRequested && !interrupted) {
                interrupted = true;
                engine.interruptGenerate();
            }
        },
    };
}

function admit<Result>(
    engine: WebLlmEngine,
    signal: AbortSignal | undefined,
    run: (active: ActiveRequest) => Promise<Result>
): Promise<Result> {
    const admission = getAdmission(engine);
    if (admission.retired !== null) {
        return Promise.reject(admission.retired);
    }
    if (signal?.aborted) {
        return Promise.reject(createAbortError(signal));
    }

    return new Promise<Result>((resolve, reject) => {
        let started = false;
        let settled = false;
        let active: ActiveRequest | null = null;
        let removeAbortListener = () => undefined;

        function resolveResult(value: Result): void {
            if (settled) {
                return;
            }
            settled = true;
            removeAbortListener();
            if (active) {
                releaseActive(engine, active);
            }
            resolve(value);
        }

        function rejectResult(reason: unknown): void {
            if (settled) {
                return;
            }
            settled = true;
            removeAbortListener();
            if (active) {
                releaseActive(engine, active);
            }
            reject(reason);
        }

        function start(): void {
            if (settled || started) {
                return;
            }
            started = true;
            active = createActiveRequest(engine, rejectResult);
            admission.active = active;
            if (signal) {
                const onAbort = () => active?.interrupt();
                signal.addEventListener('abort', onAbort, { once: true });
                removeAbortListener = () => signal.removeEventListener('abort', onAbort);
            }
            void run(active).then(
                (value) => resolveResult(value),
                (error: unknown) => rejectResult(error)
            );
        }

        function rejectQueuedAbort(): void {
            if (started || settled) {
                return;
            }
            const pendingIndex = admission.pending.findIndex((entry) => entry.abort === rejectQueuedAbort);
            if (pendingIndex >= 0) {
                const [pending] = admission.pending.splice(pendingIndex, 1);
                pending?.removeAbortListener();
            }
            rejectResult(signal ? createAbortError(signal) : new DOMException('WebLLM request aborted', 'AbortError'));
        }

        if (!admission.active) {
            start();
            return;
        }
        if (signal) {
            const onAbort = rejectQueuedAbort;
            signal.addEventListener('abort', onAbort, { once: true });
            removeAbortListener = () => signal.removeEventListener('abort', onAbort);
        }
        enqueuePending(admission, {
            signal,
            start,
            reject: rejectResult,
            abort: rejectQueuedAbort,
            removeAbortListener,
        });
    });
}

function runWebLlmRequest<RequestResult>(
    engine: WebLlmEngine,
    input: Omit<WebLlmRequestInput, 'execute'> & { execute: () => Promise<RequestResult> }
): Promise<RequestResult> {
    return admit(engine, input.signal, async (active) => {
        active.markProviderDispatched();
        const response = await input.execute();
        input.signal?.throwIfAborted();
        return response;
    });
}

function runWebLlmStream<Chunk>(engine: WebLlmEngine, input: WebLlmStreamInput<Chunk>): Promise<void> {
    return admit(engine, input.signal, async (active) => {
        let stream: AsyncIterable<Chunk>;
        try {
            stream = await input.create();
        } catch (error) {
            throw providerFailure(input, error);
        }
        const iterator = stream[Symbol.asyncIterator]();
        let interrupted = false;
        let consumerError: Error | null = null;

        function interrupt(): void {
            if (interrupted) {
                return;
            }
            interrupted = true;
            active.interrupt();
        }

        while (true) {
            const next = iterator.next();
            active.markProviderDispatched();
            if (input.signal?.aborted || consumerError !== null) {
                interrupt();
            }
            let result: IteratorResult<Chunk>;
            try {
                result = await next;
            } catch (error) {
                throw providerFailure(input, error);
            }
            if (result.done) {
                break;
            }
            if (input.signal?.aborted || consumerError !== null) {
                continue;
            }
            try {
                input.consume(result.value);
            } catch (error) {
                consumerError = toError(error);
                interrupt();
            }
        }

        if (consumerError !== null) {
            throw consumerError;
        }
        input.signal?.throwIfAborted();
    });
}

function retireWebLlmRequests(engine: WebLlmEngine, reason: unknown): void {
    const admission = getAdmission(engine);
    if (admission.retired !== null) {
        return;
    }
    const retirementError = toError(reason);
    admission.retired = retirementError;
    const active = admission.active;
    if (active) {
        active.reject(retirementError);
    }
    for (const pending of admission.pending.splice(0)) {
        pending.removeAbortListener();
        pending.reject(retirementError);
    }
}

export const webLlmRequestCoordinator = {
    run: runWebLlmRequest,
    stream: runWebLlmStream,
    retire: retireWebLlmRequests,
};
