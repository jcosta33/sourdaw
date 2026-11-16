import { getHeads } from '@automerge/automerge';

import { trackStore } from '../../src/modules/Arrangement/stores';
import { captureProjectIdentity, captureProjectRevision, getCrdtDoc } from '../../src/modules/CrdtDocument/useCases';
import { projectStore } from '../../src/modules/Project/stores';
import { saveProject } from '../../src/modules/Project/useCases';

function captureState() {
    const root = getCrdtDoc('root');
    const projectId = projectStore.value?.projectId;
    if (!root || !projectId) {
        throw new Error('Save overlap requires the actual open native project');
    }
    return {
        time: performance.now(),
        identity: captureProjectIdentity(),
        revision: captureProjectRevision(),
        heads: getHeads(root),
        projectId,
    };
}

type NativeState = ReturnType<typeof captureState>;
type Attempt = {
    url: string;
    created: number;
    requested: number | null;
    role: string;
    primaryKey: string | null;
    preparationPolicy: string | null;
    capturedHeads: string[];
    received: number | null;
    forwarded: number | null;
    terminated: number | null;
    cancelled: boolean;
    status: string | null;
    changeCount: number | null;
    replies: { received: number; forwarded: number | null; status: string | null; changeCount: number | null }[];
    held: boolean;
};
type IncrementalRequest = {
    id: number;
    requested: number;
    documents: { id: string; heads: string[]; frontier: string[] }[];
    received: number | null;
    status: string | null;
    results: { id: string; heads: string[]; bytes: number }[];
};
type SaveOverlapReport = {
    armed: NativeState;
    targetClipId: string;
    input: number | null;
    attempts: Attempt[];
    incrementalRequests: IncrementalRequest[];
    fallbackWarnings: { time: number; message: string }[];
    save: {
        requested: NativeState | null;
        preparationPosted: number | null;
        settled: NativeState | null;
        result: boolean | null;
        error: string | null;
    };
    failures: string[];
    restored: boolean;
};
type Controller = {
    report: SaveOverlapReport;
    waitForSave(): Promise<void>;
    stop(): Promise<void>;
};
let active: Controller | undefined;
const OVERLAP_LIFETIME_MS = 30_000;

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function stringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.filter((entry: unknown): entry is string => typeof entry === 'string');
}

/** A host task, rather than a promise continuation in the command's transaction. */
function hostTask(run: () => void | Promise<void>): Promise<void> {
    return new Promise((resolve, reject) => {
        const channel = new MessageChannel();
        channel.port1.onmessage = () => {
            channel.port1.close();
            channel.port2.close();
            try {
                Promise.resolve(run()).then(resolve, reject);
            } catch (error) {
                reject(error instanceof Error ? error : new Error(String(error)));
            }
        };
        channel.port2.postMessage(null);
    });
}

function classifyRequest(attempt: Attempt, data: unknown): void {
    if (!isRecord(data) || !isRecord(data.mutation)) {
        return;
    }
    attempt.requested = performance.now();
    attempt.primaryKey = typeof data.mutation.key === 'string' ? data.mutation.key : null;
    attempt.preparationPolicy = typeof data.preparationPolicy === 'string' ? data.preparationPolicy : null;
    attempt.capturedHeads = stringArray(data.heads);
    attempt.role = 'other-prospective';
    if (attempt.primaryKey === 'warpStates' && attempt.preparationPolicy === null) {
        attempt.role = 'detect';
    } else if (attempt.primaryKey === 'arrangements' && attempt.preparationPolicy === 'bounded-native-sequence-v1') {
        attempt.role = 'save-arrangements';
    }
}

function readIncrementalRequest(data: unknown): IncrementalRequest | undefined {
    if (
        !isRecord(data) ||
        data.type !== 'encodeIncrementals' ||
        typeof data.id !== 'number' ||
        !Array.isArray(data.documents)
    ) {
        return undefined;
    }
    return {
        id: data.id,
        requested: performance.now(),
        documents: data.documents.filter(isRecord).map((document) => ({
            id: typeof document.id === 'string' ? document.id : '',
            heads: stringArray(document.heads),
            frontier: stringArray(document.frontier),
        })),
        received: null,
        status: null,
        results: [],
    };
}

/** Observe existing CRDT Workers too; no bytes are read, copied or replaced. */
function observeIncrementals(
    worker: Worker,
    report: SaveOverlapReport,
    cleanups: (() => void)[]
): (request: IncrementalRequest) => void {
    const requests = new Map<number, IncrementalRequest>();
    const receive = (event: MessageEvent<unknown>): void => {
        if (!isRecord(event.data) || typeof event.data.id !== 'number') {
            return;
        }
        const request = requests.get(event.data.id);
        if (!request) {
            return;
        }
        request.received = performance.now();
        request.status = typeof event.data.type === 'string' ? event.data.type : null;
        if (Array.isArray(event.data.documents)) {
            request.results = event.data.documents.filter(isRecord).map((document) => ({
                id: typeof document.id === 'string' ? document.id : '',
                heads: stringArray(document.heads),
                bytes: document.chunk instanceof Uint8Array ? document.chunk.byteLength : -1,
            }));
        }
        requests.delete(request.id);
    };
    worker.addEventListener('message', receive, { capture: true });
    cleanups.push(() => worker.removeEventListener('message', receive, { capture: true }));
    return (request) => {
        report.incrementalRequests.push(request);
        requests.set(request.id, request);
    };
}

/** Hold only Detect's first real reply, until Save posts its actual arrangements preparation. */
export function armElasticSaveOverlap(targetClipId: string): void {
    if (active) {
        throw new Error('Save overlap controller is already armed');
    }
    if (!trackStore.value?.tracks.some((track) => track.clips.some((clip) => clip.id === targetClipId))) {
        throw new Error('Save overlap target is absent from the actual UI project');
    }
    const NativeWorker = window.Worker;
    const constructorDescriptor = Object.getOwnPropertyDescriptor(window, 'Worker');
    const postDescriptor = Object.getOwnPropertyDescriptor(NativeWorker.prototype, 'postMessage');
    const terminateDescriptor = Object.getOwnPropertyDescriptor(NativeWorker.prototype, 'terminate');
    const warningDescriptor = Object.getOwnPropertyDescriptor(console, 'warn');
    if (!constructorDescriptor || !postDescriptor || !terminateDescriptor || !warningDescriptor) {
        throw new Error('Save overlap requires restorable native descriptors');
    }
    const report: SaveOverlapReport = {
        armed: captureState(),
        targetClipId,
        input: null,
        attempts: [],
        incrementalRequests: [],
        fallbackWarnings: [],
        save: { requested: null, preparationPosted: null, settled: null, result: null, error: null },
        failures: [],
        restored: false,
    };
    const cleanups: (() => void)[] = [];
    const attempts = new WeakMap<Worker, Attempt>();
    const incrementals = new WeakMap<Worker, ReturnType<typeof observeIncrementals>>();
    let held: { attempt: Attempt; forward(): void } | undefined;
    let selected = false;
    let stopping: Promise<void> | undefined;
    let forwardWork: Promise<void> | undefined;
    let stopped = false;
    let finishSave: () => void = () => undefined;
    const saveSettled = new Promise<void>((resolve) => {
        finishSave = resolve;
    });
    let deadline: ReturnType<typeof setTimeout> | undefined;

    function releaseHeld(): void {
        held?.forward();
    }
    function startSave(): void {
        deadline = setTimeout(() => {
            report.failures.push('Actual Save overlap exceeded its bounded lifetime');
            releaseHeld();
            finishSave();
        }, OVERLAP_LIFETIME_MS);
        void hostTask(async () => {
            report.save.requested = captureState();
            try {
                report.save.result = await saveProject();
            } catch (error) {
                report.save.error = String(error);
            } finally {
                report.save.settled = captureState();
                performance.mark('elastic-save-settled');
                if (report.save.preparationPosted === null) {
                    report.failures.push('Actual Save settled without posting bounded arrangements preparation');
                    releaseHeld();
                }
                clearTimeout(deadline);
                finishSave();
            }
        }).catch((error: unknown) => {
            report.failures.push(String(error));
            releaseHeld();
            finishSave();
        });
    }
    function receiveProspective(worker: Worker, attempt: Attempt, event: MessageEvent<unknown>): void {
        attempt.received = performance.now();
        if (isRecord(event.data)) {
            attempt.status = typeof event.data.status === 'string' ? event.data.status : null;
            attempt.changeCount = Array.isArray(event.data.changes) ? event.data.changes.length : null;
        }
        const reply: Attempt['replies'][number] = {
            received: attempt.received,
            forwarded: null,
            status: attempt.status,
            changeCount: attempt.changeCount,
        };
        attempt.replies.push(reply);
        if (attempt.replies.length > 1) {
            report.failures.push('Private prospective Worker emitted more than one reply');
        }
        if (attempt.role !== 'detect' || selected || stopped) {
            attempt.forwarded = performance.now();
            reply.forwarded = attempt.forwarded;
            return;
        }
        const handler = worker.onmessage;
        if (!handler) {
            report.failures.push('Detect reply has no current client handler');
            return;
        }
        selected = true;
        attempt.held = true;
        event.stopImmediatePropagation();
        held = {
            attempt,
            forward() {
                if (forwardWork) {
                    return;
                }
                forwardWork = hostTask(() => {
                    if (attempt.terminated !== null || worker.onmessage !== handler) {
                        report.failures.push('Held Detect reply lost its live client before forwarding');
                        return;
                    }
                    attempt.forwarded = performance.now();
                    reply.forwarded = attempt.forwarded;
                    handler.call(worker, event);
                }).catch((error: unknown) => {
                    report.failures.push(String(error));
                });
            },
        };
        startSave();
    }
    function observeProspective(worker: Worker, url: URL): void {
        const attempt: Attempt = {
            url: url.href,
            created: performance.now(),
            requested: null,
            role: 'unclassified',
            primaryKey: null,
            preparationPolicy: null,
            capturedHeads: [],
            received: null,
            forwarded: null,
            terminated: null,
            cancelled: false,
            status: null,
            changeCount: null,
            replies: [],
            held: false,
        };
        attempts.set(worker, attempt);
        report.attempts.push(attempt);
        const receive = (event: MessageEvent<unknown>): void => receiveProspective(worker, attempt, event);
        const fail = (): void => {
            report.failures.push(`Native prospective ${attempt.role} attempt failed`);
        };
        worker.addEventListener('message', receive, { capture: true });
        worker.addEventListener('error', fail);
        worker.addEventListener('messageerror', fail);
        cleanups.push(() => {
            worker.removeEventListener('message', receive, { capture: true });
            worker.removeEventListener('error', fail);
            worker.removeEventListener('messageerror', fail);
        });
    }
    const ObservedWorker = new Proxy(NativeWorker, {
        construct(Constructor, args: ConstructorParameters<typeof Worker>, newTarget): object {
            const instance: unknown = Reflect.construct(Constructor, args, newTarget);
            const url = new URL(args[0], location.href);
            const input = performance.getEntriesByName('elastic-detect-input-start').at(-1);
            if (typeof instance !== 'object' || instance === null) {
                throw new TypeError('Native Worker construction did not return an object');
            }
            if (
                url.pathname !== '/src/modules/CrdtDocument/workers/prospectiveMutationWorker.ts' ||
                !input ||
                input.startTime < report.armed.time ||
                stopped
            ) {
                return instance;
            }
            if (!(instance instanceof NativeWorker)) {
                throw new TypeError('Observed prospective constructor must retain the native Worker prototype');
            }
            report.input ??= input.startTime;
            observeProspective(instance, url);
            return instance;
        },
    });
    const postMessage = NativeWorker.prototype.postMessage;
    const observedPost = new Proxy(postMessage, {
        apply(target, receiver: Worker, args: unknown[]): unknown {
            const attempt = attempts.get(receiver);
            if (attempt) {
                classifyRequest(attempt, args[0]);
            }
            const request = receiver instanceof NativeWorker ? readIncrementalRequest(args[0]) : undefined;
            const result: unknown = Reflect.apply(target, receiver, args);
            if (request) {
                let observe = incrementals.get(receiver);
                if (!observe) {
                    observe = observeIncrementals(receiver, report, cleanups);
                    incrementals.set(receiver, observe);
                }
                observe(request);
            }
            if (
                attempt?.role === 'save-arrangements' &&
                report.save.requested &&
                held &&
                report.save.preparationPosted === null
            ) {
                report.save.preparationPosted = performance.now();
                releaseHeld();
            }
            return result;
        },
    });
    const terminate = NativeWorker.prototype.terminate;
    const observedTerminate = new Proxy(terminate, {
        apply(target, receiver: Worker, args: unknown[]): unknown {
            const result: unknown = Reflect.apply(target, receiver, args);
            const attempt = attempts.get(receiver);
            if (attempt) {
                attempt.terminated = performance.now();
                attempt.cancelled = attempt.forwarded === null;
            }
            return result;
        },
    });
    const observedWarn = new Proxy(console.warn, {
        apply(target, receiver: unknown, args: unknown[]): unknown {
            const warning = args.find(
                (argument): argument is string =>
                    typeof argument === 'string' &&
                    argument.startsWith('[AutomergeRepository]') &&
                    /synchronous|main thread/.test(argument)
            );
            if (warning !== undefined) {
                report.fallbackWarnings.push({ time: performance.now(), message: warning });
            }
            return Reflect.apply(target, receiver, args);
        },
    });
    Object.defineProperty(window, 'Worker', { ...constructorDescriptor, value: ObservedWorker });
    Object.defineProperty(NativeWorker.prototype, 'postMessage', { ...postDescriptor, value: observedPost });
    Object.defineProperty(NativeWorker.prototype, 'terminate', { ...terminateDescriptor, value: observedTerminate });
    Object.defineProperty(console, 'warn', { ...warningDescriptor, value: observedWarn });
    active = {
        report,
        async waitForSave(): Promise<void> {
            if (!selected) {
                throw new Error('Detect completed without the required held native reply');
            }
            await saveSettled;
            if (!report.save.settled) {
                throw new Error('Actual public Save did not settle within the overlap lifetime');
            }
        },
        stop(): Promise<void> {
            stopping ??= (async () => {
                if (held && held.attempt.forwarded === null && report.save.preparationPosted === null) {
                    report.failures.push('Controller cleanup released Detect without actual Save preparation');
                }
                releaseHeld();
                if (selected) {
                    await saveSettled;
                }
                await forwardWork;
                stopped = true;
                clearTimeout(deadline);
                for (const cleanup of cleanups) {
                    try {
                        cleanup();
                    } catch (error) {
                        report.failures.push(String(error));
                    }
                }
                Object.defineProperty(window, 'Worker', constructorDescriptor);
                Object.defineProperty(NativeWorker.prototype, 'postMessage', postDescriptor);
                Object.defineProperty(NativeWorker.prototype, 'terminate', terminateDescriptor);
                Object.defineProperty(console, 'warn', warningDescriptor);
                report.restored = true;
            })();
            return stopping;
        },
    };
}

/** Wait without restoring observers; the trace must include both endpoints and its rAF tail. */
export async function waitForElasticSaveOverlap(): Promise<void> {
    if (!active) {
        throw new Error('Save overlap controller is not armed');
    }
    await active.waitForSave();
}

/** Available even when a measurement or functional assertion failed. */
export async function stopElasticSaveOverlap(): Promise<SaveOverlapReport | null> {
    if (!active) {
        return null;
    }
    const controller = active;
    try {
        await controller.stop();
        return controller.report;
    } finally {
        active = undefined;
    }
}
