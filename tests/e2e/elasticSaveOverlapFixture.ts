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
    received: number | null;
    forwarded: number | null;
    terminated: number | null;
    status: string | null;
    held: boolean;
};
type SaveOverlapReport = {
    armed: NativeState;
    targetClipId: string;
    input: number | null;
    attempts: Attempt[];
    save: {
        requested: NativeState | null;
        settled: NativeState | null;
        result: boolean | null;
        error: string | null;
    };
    failures: string[];
    restored: boolean;
};
type Controller = {
    report: SaveOverlapReport;
    stop: () => Promise<void>;
};
let active: Controller | undefined;

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

/** Hold one genuine reply while a real queued Save completes; never replace its bytes. */
export function armElasticSaveOverlap(targetClipId: string): void {
    if (active) {
        throw new Error('Save overlap controller is already armed');
    }
    if (!trackStore.value?.tracks.some((track) => track.clips.some((clip) => clip.id === targetClipId))) {
        throw new Error('Save overlap target is absent from the actual UI project');
    }
    const NativeWorker = window.Worker;
    const report: SaveOverlapReport = {
        armed: captureState(),
        targetClipId,
        input: null,
        attempts: [],
        save: { requested: null, settled: null, result: null, error: null },
        failures: [],
        restored: false,
    };
    const cleanups: (() => void)[] = [];
    let saveWork: Promise<void> | undefined;
    let forwardWork: Promise<void> | undefined;
    let forwardHeld: (() => void) | undefined;
    let stopping: Promise<void> | undefined;
    let stopped = false;
    const ObservedWorker = new Proxy(NativeWorker, {
        construct(Constructor, args: ConstructorParameters<typeof Worker>, newTarget): object {
            // Construction and postMessage remain native: Save does not gate startup.
            const instance: unknown = Reflect.construct(Constructor, args, newTarget);
            if (typeof instance !== 'object' || instance === null) {
                throw new TypeError('Native Worker construction did not return an object');
            }
            const url = new URL(args[0], location.href);
            const input = performance.getEntriesByName('elastic-detect-input-start').at(-1);
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
            const worker = instance;
            report.input ??= input.startTime;
            const attempt: Attempt = {
                url: url.href,
                created: performance.now(),
                received: null,
                forwarded: null,
                terminated: null,
                status: null,
                held: report.attempts.length === 0,
            };
            report.attempts.push(attempt);
            const terminate = worker.terminate;
            const terminateDescriptor = Object.getOwnPropertyDescriptor(worker, 'terminate');
            worker.terminate = function (this: Worker): void {
                terminate.call(this);
                if (this === worker) {
                    attempt.terminated = performance.now();
                }
            };
            const onError = (): void => {
                report.failures.push(`Native prospective attempt ${report.attempts.indexOf(attempt)} failed`);
                forwardHeld = undefined;
            };
            const onMessage = (event: MessageEvent<unknown>): void => {
                attempt.received = performance.now();
                if (typeof event.data === 'object' && event.data !== null && 'status' in event.data) {
                    attempt.status = typeof event.data.status === 'string' ? event.data.status : null;
                }
                if (!attempt.held) {
                    // The private handler runs next in this same native dispatch.
                    attempt.forwarded = performance.now();
                    return;
                }
                event.stopImmediatePropagation();
                const handler = worker.onmessage;
                if (!handler || forwardHeld || attempt.forwarded !== null) {
                    report.failures.push('Held native reply has no unique current client handler');
                    return;
                }
                forwardHeld = () => {
                    if (forwardWork) {
                        return;
                    }
                    forwardWork = hostTask(() => {
                        if (stopped || attempt.terminated !== null || worker.onmessage !== handler) {
                            report.failures.push('Held native reply lost its live client before forwarding');
                            return;
                        }
                        attempt.forwarded = performance.now();
                        handler.call(worker, event);
                    }).catch((error: unknown) => {
                        report.failures.push(String(error));
                    });
                };
                if (report.save.settled) {
                    forwardHeld();
                }
            };
            worker.addEventListener('message', onMessage, { capture: true });
            worker.addEventListener('error', onError);
            worker.addEventListener('messageerror', onError);
            cleanups.push(() => {
                worker.removeEventListener('message', onMessage, { capture: true });
                worker.removeEventListener('error', onError);
                worker.removeEventListener('messageerror', onError);
                if (terminateDescriptor) {
                    Object.defineProperty(worker, 'terminate', terminateDescriptor);
                } else if (!Reflect.deleteProperty(worker, 'terminate')) {
                    throw new Error('Observed Worker termination descriptor could not be restored');
                }
            });
            if (attempt.held) {
                saveWork = hostTask(async () => {
                    report.save.requested = captureState();
                    try {
                        report.save.result = await saveProject();
                    } catch (error) {
                        report.save.error = String(error);
                    } finally {
                        report.save.settled = captureState();
                        forwardHeld?.();
                    }
                }).catch((error: unknown) => {
                    report.failures.push(String(error));
                });
            }
            return worker;
        },
    });
    window.Worker = ObservedWorker;
    active = {
        report,
        stop(): Promise<void> {
            stopping ??= (async () => {
                await saveWork;
                await forwardWork;
                stopped = true;
                for (const cleanup of cleanups) {
                    try {
                        cleanup();
                    } catch (error) {
                        report.failures.push(String(error));
                    }
                }
                if (window.Worker === ObservedWorker) {
                    window.Worker = NativeWorker;
                    report.restored = true;
                } else {
                    report.failures.push('Save overlap Worker constructor changed before restoration');
                }
            })();
            return stopping;
        },
    };
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
