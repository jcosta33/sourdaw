import { getHeads } from '@automerge/automerge';

import { trackStore } from '../../src/modules/Arrangement/stores';
import {
    captureProjectIdentity,
    captureProjectRevision,
    getCrdtDoc,
    subscribeToCrdtChanges,
} from '../../src/modules/CrdtDocument/useCases';
import { projectStore } from '../../src/modules/Project/stores';
import { saveProject } from '../../src/modules/Project/useCases';
import { matchesJsonFingerprint } from '../../src/utils/jsonSemanticEquality';
import { valuesEqual } from '../../src/utils/structuralEquality';

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
    requestState: NativeState | null;
    posted: number | null;
    role: string;
    primaryKey: string | null;
    preparationPolicy: string | null;
    capturedHeads: string[];
    targetWarpStateAtRequest: string | null;
    expectedTargetWarpState: unknown;
    received: number | null;
    receivedState: NativeState | null;
    forwarded: number | null;
    forwardedState: NativeState | null;
    terminated: number | null;
    terminatedState: NativeState | null;
    status: string | null;
    changeCount: number | null;
    replyHeads: string[];
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
    expectedMarkerCount: number;
    baselineTargetWarpState: string;
    detectPublication: { state: NativeState; targetWarpState: string } | null;
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
function targetWarpState(value: unknown, clipId: string): unknown {
    return isRecord(value) && isRecord(value.states) ? (value.states[clipId] ?? null) : null;
}
function serializeWitness(value: unknown): string {
    const json = JSON.stringify(value);
    if (typeof json !== 'string') {
        throw new TypeError('Native overlap witness must be serializable');
    }
    return json;
}
function nativeTargetWarpState(clipId: string): unknown {
    const root = getCrdtDoc<Record<string, unknown>>('root');
    if (!root) {
        throw new Error('Save overlap lost the actual native root');
    }
    return targetWarpState(root.warpStates, clipId);
}
function sameHeads(left: readonly string[], right: readonly string[]): boolean {
    return left.length === right.length && left.every((head) => right.includes(head));
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

function classifyRequest(attempt: Attempt, data: unknown, targetClipId: string): void {
    if (!isRecord(data) || !isRecord(data.mutation)) {
        return;
    }
    attempt.requestState = captureState();
    attempt.requested = attempt.requestState.time;
    attempt.targetWarpStateAtRequest = serializeWitness(nativeTargetWarpState(targetClipId));
    attempt.primaryKey = typeof data.mutation.key === 'string' ? data.mutation.key : null;
    attempt.preparationPolicy = typeof data.preparationPolicy === 'string' ? data.preparationPolicy : null;
    attempt.capturedHeads = stringArray(data.heads);
    attempt.role = 'other-prospective';
    if (data.mutation.kind !== 'canonical-json-slot-v1' || attempt.preparationPolicy !== 'bounded-native-sequence-v1') {
        return;
    }
    if (attempt.primaryKey === 'warpStates') {
        attempt.role = 'detect';
        attempt.expectedTargetWarpState = structuredClone(targetWarpState(data.mutation.value, targetClipId));
    } else if (attempt.primaryKey === 'arrangements') {
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
    report: Pick<SaveOverlapReport, 'incrementalRequests'>,
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

type PassiveIncrementalReport = {
    incrementalRequests: IncrementalRequest[];
    otherPersistenceRequests: { id: number; type: string }[];
    failures: string[];
    restored: boolean;
};
let passiveIncremental: { report: PassiveIncrementalReport; stop(): void } | undefined;

/** Observe an edit-to-Save span, including an already-running native CRDT Worker. */
export function armElasticIncrementalObservation(): void {
    if (active || passiveIncremental) {
        throw new Error('Incremental observation requires exclusive native Worker descriptors');
    }
    const prototype = Worker.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'postMessage');
    const warningDescriptor = Object.getOwnPropertyDescriptor(console, 'warn');
    if (!descriptor || !warningDescriptor) {
        throw new Error('Incremental observation requires restorable native descriptors');
    }
    const report: PassiveIncrementalReport = {
        incrementalRequests: [],
        otherPersistenceRequests: [],
        failures: [],
        restored: false,
    };
    const cleanups: (() => void)[] = [];
    const workers = new WeakMap<Worker, ReturnType<typeof observeIncrementals>>();
    const postMessage = prototype.postMessage;
    const warn = console.warn;
    const observedPost = new Proxy(prototype.postMessage, {
        apply(original, receiver: Worker, args: unknown[]): unknown {
            const request = receiver instanceof Worker ? readIncrementalRequest(args[0]) : undefined;
            let observe = workers.get(receiver);
            if (request && !observe) {
                observe = observeIncrementals(receiver, report, cleanups);
                workers.set(receiver, observe);
                const fail = (): void => {
                    report.failures.push('Actual incremental Worker emitted a native error');
                };
                receiver.addEventListener('error', fail);
                receiver.addEventListener('messageerror', fail);
                cleanups.push(() => {
                    receiver.removeEventListener('error', fail);
                    receiver.removeEventListener('messageerror', fail);
                });
            }
            const data = args[0];
            if (
                isRecord(data) &&
                typeof data.id === 'number' &&
                (data.type === 'compactShadow' || data.type === 'loadBundle')
            ) {
                report.otherPersistenceRequests.push({ id: data.id, type: data.type });
            }
            const returned: unknown = Reflect.apply(original, receiver, args);
            if (request && observe) {
                observe(request);
            }
            return returned;
        },
    });
    const observedWarn = new Proxy(warn, {
        apply(original, receiver: unknown, args: unknown[]): unknown {
            const warning = args.find(
                (argument): argument is string =>
                    typeof argument === 'string' && argument.startsWith('[AutomergeRepository]')
            );
            if (warning) {
                report.failures.push(warning);
            }
            return Reflect.apply(original, receiver, args);
        },
    });
    Object.defineProperty(prototype, 'postMessage', { ...descriptor, value: observedPost });
    Object.defineProperty(console, 'warn', { ...warningDescriptor, value: observedWarn });
    passiveIncremental = {
        report,
        stop() {
            try {
                if (prototype.postMessage !== observedPost) {
                    report.failures.push('Native postMessage descriptor changed during incremental observation');
                } else {
                    Object.defineProperty(prototype, 'postMessage', descriptor);
                }
            } catch (error) {
                report.failures.push(String(error));
            } finally {
                try {
                    if (console.warn !== observedWarn) {
                        report.failures.push('Native warning descriptor changed during incremental observation');
                    } else {
                        Object.defineProperty(console, 'warn', warningDescriptor);
                    }
                } catch (error) {
                    report.failures.push(String(error));
                }
                for (const cleanup of cleanups) {
                    try {
                        cleanup();
                    } catch (error) {
                        report.failures.push(String(error));
                    }
                }
                report.restored = prototype.postMessage === postMessage && console.warn === warn;
            }
        },
    };
}

export function stopElasticIncrementalObservation(): PassiveIncrementalReport {
    if (!passiveIncremental) {
        throw new Error('Installed incremental observation is missing during cleanup');
    }
    const current = passiveIncremental;
    current.stop();
    if (current.report.restored) {
        passiveIncremental = undefined;
    }
    return current.report;
}

/** Release Detect at Save's real post, then make Save observe the actual Detect publication. */
export function armElasticSaveOverlap(targetClipId: string, expectedMarkerCount: number): void {
    if (active) {
        throw new Error('Save overlap controller is already armed');
    }
    if (!trackStore.value?.tracks.some((track) => track.clips.some((clip) => clip.id === targetClipId))) {
        throw new Error('Save overlap target is absent from the actual UI project');
    }
    if (!Number.isSafeInteger(expectedMarkerCount) || expectedMarkerCount < 1) {
        throw new Error('Save overlap requires a nonempty expected Detect result');
    }
    const baseline = nativeTargetWarpState(targetClipId);
    if (baseline !== null && (!isRecord(baseline) || !Array.isArray(baseline.markers) || baseline.markers.length > 0)) {
        throw new Error('Cold Save overlap requires an empty native target warp state');
    }
    const baselineTargetWarpState = serializeWitness(baseline);
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
        expectedMarkerCount,
        baselineTargetWarpState,
        detectPublication: null,
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
    const observedWorkers = new Map<Worker, Attempt>();
    const incrementals = new WeakMap<Worker, ReturnType<typeof observeIncrementals>>();
    type HeldReply = { attempt: Attempt; forward(): Promise<void> };
    let heldDetect: HeldReply | undefined;
    let heldSave: HeldReply | undefined;
    let firstSave: Attempt | undefined;
    let stopping: Promise<void> | undefined;
    let stopped = false;
    let expired = false;
    let finishSave: () => void = () => undefined;
    const saveFinishedOrExpired = new Promise<void>((resolve) => {
        finishSave = resolve;
    });
    let deadline: ReturnType<typeof setTimeout> | undefined;

    function releaseHeld(): void {
        void heldDetect?.forward();
        void heldSave?.forward();
    }
    function forwardReply(attempt: Attempt, reply: Attempt['replies'][number]): void {
        attempt.forwardedState = captureState();
        attempt.forwarded = attempt.forwardedState.time;
        reply.forwarded = attempt.forwarded;
    }
    function holdReply(
        worker: Worker,
        attempt: Attempt,
        event: MessageEvent<unknown>,
        reply: Attempt['replies'][number],
        hasWitness: () => boolean
    ): HeldReply | undefined {
        const handler = worker.onmessage;
        if (!handler) {
            report.failures.push(`Held ${attempt.role} reply has no current client handler`);
            return undefined;
        }
        event.stopImmediatePropagation();
        attempt.held = true;
        let work: Promise<void> | undefined;
        return {
            attempt,
            forward() {
                work ??= hostTask(() => {
                    if (!hasWitness()) {
                        report.failures.push(`Released ${attempt.role} reply without its required native witness`);
                    }
                    if (attempt.terminated !== null || worker.onmessage !== handler) {
                        report.failures.push(`Held ${attempt.role} reply lost its live client before forwarding`);
                        return;
                    }
                    forwardReply(attempt, reply);
                    handler.call(worker, event);
                }).catch((error: unknown) => {
                    report.failures.push(String(error));
                });
                return work;
            },
        };
    }
    function startSave(): void {
        deadline = setTimeout(() => {
            report.failures.push('Actual Save overlap exceeded its bounded lifetime');
            expired = true;
            releaseHeld();
            // This releases only the observation wait; settlement is recorded solely by the real Save.
            finishSave();
        }, OVERLAP_LIFETIME_MS);
        void hostTask(async () => {
            report.save.requested = captureState();
            try {
                report.save.result = await saveProject();
            } catch (error) {
                report.save.error = String(error);
            } finally {
                try {
                    report.save.settled = captureState();
                    performance.mark('elastic-save-settled');
                    if (report.save.preparationPosted === null) {
                        report.failures.push('Actual Save settled without posting bounded arrangements preparation');
                        releaseHeld();
                    }
                } finally {
                    clearTimeout(deadline);
                    finishSave();
                }
            }
        }).catch((error: unknown) => {
            report.failures.push(String(error));
            releaseHeld();
            finishSave();
        });
    }
    function receiveProspective(worker: Worker, attempt: Attempt, event: MessageEvent<unknown>): void {
        attempt.receivedState = captureState();
        attempt.received = attempt.receivedState.time;
        if (isRecord(event.data)) {
            attempt.status = typeof event.data.status === 'string' ? event.data.status : null;
            attempt.changeCount = Array.isArray(event.data.changes) ? event.data.changes.length : null;
            attempt.replyHeads = stringArray(event.data.heads);
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
            return;
        }
        if (attempt === firstSave && !report.detectPublication && !stopped && !expired) {
            heldSave = holdReply(worker, attempt, event, reply, () => report.detectPublication !== null);
            return;
        }
        if (attempt.role !== 'detect' || heldDetect || stopped || expired) {
            forwardReply(attempt, reply);
            return;
        }
        if (attempt.status !== 'complete' || attempt.changeCount === null || attempt.changeCount < 1) {
            report.failures.push('Cold Detect must return an actual nonempty native change');
        }
        heldDetect = holdReply(worker, attempt, event, reply, () => report.save.preparationPosted !== null);
        if (heldDetect) {
            startSave();
        }
    }
    function observeProspective(worker: Worker, url: URL): void {
        const attempt: Attempt = {
            url: url.href,
            created: performance.now(),
            requested: null,
            requestState: null,
            posted: null,
            role: 'unclassified',
            primaryKey: null,
            preparationPolicy: null,
            capturedHeads: [],
            targetWarpStateAtRequest: null,
            expectedTargetWarpState: null,
            received: null,
            receivedState: null,
            forwarded: null,
            forwardedState: null,
            terminated: null,
            terminatedState: null,
            status: null,
            changeCount: null,
            replyHeads: [],
            replies: [],
            held: false,
        };
        attempts.set(worker, attempt);
        observedWorkers.set(worker, attempt);
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
    cleanups.push(
        subscribeToCrdtChanges((docId) => {
            if (docId !== 'root' || report.detectPublication || !heldDetect || !firstSave || stopped || expired) {
                return;
            }
            try {
                const expected = heldDetect.attempt.expectedTargetWarpState;
                const actual = nativeTargetWarpState(targetClipId);
                if (!valuesEqual(actual, expected) || matchesJsonFingerprint(actual, baselineTargetWarpState)) {
                    return;
                }
                const state = captureState();
                if (
                    state.identity !== report.armed.identity ||
                    state.projectId !== report.armed.projectId ||
                    sameHeads(state.heads, heldDetect.attempt.capturedHeads) ||
                    sameHeads(state.heads, firstSave.capturedHeads)
                ) {
                    return;
                }
                report.detectPublication = { state, targetWarpState: serializeWitness(actual) };
                void heldSave?.forward();
            } catch (error) {
                report.failures.push(String(error));
            }
        })
    );
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
                if (attempt.requested !== null) {
                    report.failures.push('Private prospective Worker posted more than one request');
                }
                classifyRequest(attempt, args[0], targetClipId);
                if (attempt.role === 'detect') {
                    const expected = attempt.expectedTargetWarpState;
                    if (
                        !isRecord(expected) ||
                        !Array.isArray(expected.markers) ||
                        expected.markers.length !== expectedMarkerCount ||
                        matchesJsonFingerprint(expected, baselineTargetWarpState)
                    ) {
                        report.failures.push(
                            'Cold Detect request must replace the empty target with actual expected markers'
                        );
                    }
                }
            }
            const request = receiver instanceof NativeWorker ? readIncrementalRequest(args[0]) : undefined;
            const result: unknown = Reflect.apply(target, receiver, args);
            if (attempt) {
                attempt.posted = performance.now();
            }
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
                heldDetect &&
                report.save.preparationPosted === null
            ) {
                firstSave = attempt;
                report.save.preparationPosted = performance.now();
                void heldDetect.forward();
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
                attempt.terminatedState = captureState();
                attempt.terminated = attempt.terminatedState.time;
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
            if (!heldDetect) {
                throw new Error('Detect completed without the required held native reply');
            }
            await saveFinishedOrExpired;
            if (!report.save.settled) {
                throw new Error('Actual public Save did not settle within the overlap lifetime');
            }
        },
        stop(): Promise<void> {
            stopping ??= (async () => {
                try {
                    releaseHeld();
                    if (heldDetect) {
                        await saveFinishedOrExpired;
                    }
                    await heldDetect?.forward();
                    await heldSave?.forward();
                    for (const [worker, attempt] of observedWorkers) {
                        if (attempt.terminated === null) {
                            report.failures.push(`Native ${attempt.role} Worker remained live at controller cleanup`);
                            worker.terminate();
                        }
                    }
                } catch (error) {
                    report.failures.push(String(error));
                } finally {
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
                }
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
