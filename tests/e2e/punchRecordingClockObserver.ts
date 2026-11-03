import type { Page } from '@playwright/test';

export const RECORDING_RENDER_QUANTUM_FRAMES = 128;

type RecordingFrame = {
    contextFrame: number;
    sampleRate: number;
    sampleZeroContextFrame: number | null;
    publishedFrames: number;
};

type OutputPosition = {
    gestureBeat: number;
    playheadBeat: number;
    wrapCount: number;
    isRecording: boolean;
};

type ClockObservation = {
    recording: RecordingFrame | null;
    output: OutputPosition | null;
};

type ClockEvent = ClockObservation & {
    kind: string;
    publishedFrames?: number;
    sampleZeroContextFrame?: number;
    sampleRate?: number;
    wavBytes?: number;
};

type UnstableClockRead = {
    contextFrameBefore: number;
    contextFrameAfter: number | null;
    sequenceBefore: number;
    sequenceAfter: number | null;
};

type ClockReadDiagnostics = {
    unstableAttempts: number;
    exhaustedReads: number;
    recentUnstableAttempts: UnstableClockRead[];
};

type RuntimeWitness = {
    admission: PunchRecordingClockWitness['admission'] | null;
    firstFrame: ClockObservation | null;
    samples: ClockObservation[];
    events: ClockEvent[];
    control: Int32Array | null;
    context: BaseAudioContext | null;
    admissionContext: BaseAudioContext | null;
    readOutput: (() => OutputPosition) | null;
    stopSent: boolean;
    readDiagnostics: ClockReadDiagnostics;
};

export type DiagnosticWindow = Window & {
    __punchRecordingClockWitness?: RuntimeWitness;
    __readPunchRecordingClock?: () => ClockObservation;
};

export type PunchRecordingClockWitness = {
    admission: {
        baseLatencySeconds: number;
        outputLatencySeconds: number;
        trackCompensationSeconds: number;
    };
    firstFrame: ClockObservation | null;
    samples: ClockObservation[];
    events: ClockEvent[];
    readDiagnostics: ClockReadDiagnostics;
};

export type LivePunchRecordingClock = ClockObservation & {
    admission: PunchRecordingClockWitness['admission'];
};

export type PunchClockReference = {
    gestureBeat: number;
    gestureContextFrame: number;
    sampleZeroContextFrame: number;
    capturedFrames: number;
    sampleRate: number;
    frozenLatencySeconds: number;
    tempo: number;
};

/** The independent 120 BPM fixture clock: source samples stop at their last captured frame. */
export function compensatedCaptureFrontierBeat(input: PunchClockReference): number {
    const finalContextFrame = input.sampleZeroContextFrame + input.capturedFrames;
    const uncapturedSeconds = (input.gestureContextFrame - finalContextFrame) / input.sampleRate;
    return input.gestureBeat - ((uncapturedSeconds + input.frozenLatencySeconds) * input.tempo) / 60;
}

export function frozenRecordingLatency(witness: PunchRecordingClockWitness): number {
    return (
        witness.admission.baseLatencySeconds +
        witness.admission.outputLatencySeconds +
        witness.admission.trackCompensationSeconds
    );
}

export function captureFrameDrift(frame: RecordingFrame): number | null {
    if (frame.sampleZeroContextFrame === null) {
        return null;
    }
    return frame.contextFrame - frame.sampleZeroContextFrame - frame.publishedFrames;
}

export function stopClockEvent(witness: PunchRecordingClockWitness): ClockEvent {
    const event = witness.events.find((entry) => entry.kind === 'send-worklet-stop');
    if (!event?.recording || !event.output || event.recording.sampleZeroContextFrame === null) {
        throw new Error('The real worklet Stop has no stable sample-zero and gesture witness');
    }
    return event;
}

export function finalCapturedFrames(witness: PunchRecordingClockWitness): number {
    const ack = witness.events.find((entry) => entry.kind === 'worklet-stopped-ack');
    if (ack?.publishedFrames === undefined) {
        throw new Error('The worklet did not acknowledge its final captured frame count');
    }
    return ack.publishedFrames;
}

export async function installPunchRecordingClockWitness(page: Pick<Page, 'addInitScript'>): Promise<void> {
    await page.addInitScript(() => {
        const host = window as DiagnosticWindow;
        const state: RuntimeWitness = {
            admission: null,
            firstFrame: null,
            samples: [],
            events: [],
            control: null,
            context: null,
            admissionContext: null,
            readOutput: null,
            stopSent: false,
            readDiagnostics: { unstableAttempts: 0, exhaustedReads: 0, recentUnstableAttempts: [] },
        };
        host.__punchRecordingClockWitness = state;
        const recordUnstableRead = (attempt: UnstableClockRead): void => {
            const diagnostics = state.readDiagnostics;
            diagnostics.unstableAttempts++;
            diagnostics.recentUnstableAttempts.push(attempt);
            if (diagnostics.recentUnstableAttempts.length > 16) {
                diagnostics.recentUnstableAttempts.shift();
            }
        };
        const read = (): RecordingFrame | null => {
            if (!state.context || !state.control) {
                return null;
            }
            const control = state.control;
            const sampleRate = state.context.sampleRate;
            for (let attempt = 0; attempt < 8; attempt++) {
                const contextFrameBefore = Math.round(state.context.currentTime * sampleRate);
                const before = Atomics.load(control, 0) >>> 0;
                if ((before & 1) !== 0) {
                    recordUnstableRead({
                        contextFrameBefore,
                        contextFrameAfter: null,
                        sequenceBefore: before,
                        sequenceAfter: null,
                    });
                    continue;
                }
                const low = Atomics.load(control, 1) >>> 0;
                const high = Atomics.load(control, 2) >>> 0;
                const zeroLow = Atomics.load(control, 3) >>> 0;
                const zeroHigh = Atomics.load(control, 4) >>> 0;
                const present = Atomics.load(control, 5);
                const contextFrameAfter = Math.round(state.context.currentTime * sampleRate);
                // The publication fence includes the context read: otherwise a complete
                // quantum can pair its newer clock with a previously accepted count.
                const after = Atomics.load(control, 0) >>> 0;
                if (before !== after || (after & 1) !== 0 || contextFrameBefore !== contextFrameAfter) {
                    recordUnstableRead({
                        contextFrameBefore,
                        contextFrameAfter,
                        sequenceBefore: before,
                        sequenceAfter: after,
                    });
                    continue;
                }
                return {
                    contextFrame: contextFrameAfter,
                    sampleRate,
                    sampleZeroContextFrame: present === 1 ? zeroHigh * 0x1_0000_0000 + zeroLow : null,
                    publishedFrames: high * 0x1_0000_0000 + low,
                };
            }
            // A producer may remain busy through this bounded read. Retain the
            // unavailable observation separately from a stable missing-input gap.
            state.readDiagnostics.exhaustedReads++;
            return null;
        };
        const observe = (): ClockObservation => ({ recording: read(), output: state.readOutput?.() ?? null });
        const event = (kind: string, extra: Partial<ClockEvent> = {}): void => {
            state.events.push({ kind, ...observe(), ...extra });
        };
        host.__readPunchRecordingClock = observe;
        const record = (value: unknown): Record<string, unknown> | null => {
            if (typeof value !== 'object' || value === null) {
                return null;
            }
            return value as Record<string, unknown>;
        };
        const OriginalNode = window.AudioWorkletNode;
        Reflect.set(
            window,
            'AudioWorkletNode',
            new Proxy(OriginalNode, {
                construct(target, args) {
                    const node = Reflect.construct(target, args) as AudioWorkletNode;
                    if (args[1] !== 'recording-processor') {
                        return node;
                    }
                    state.context = node.context;
                    const port = node.port;
                    const originalPost = port.postMessage;
                    port.postMessage = (
                        message: unknown,
                        ...rest: [transferOrOptions?: Transferable[] | StructuredSerializeOptions]
                    ): void => {
                        const data = record(message);
                        if (data?.type === 'init' && data.sab instanceof SharedArrayBuffer) {
                            state.control = new Int32Array(data.sab, 0, 6);
                        }
                        if (data?.type === 'start' || data?.type === 'stop') {
                            event(`send-worklet-${data.type}`);
                            if (data.type === 'stop') {
                                state.stopSent = true;
                            }
                        }
                        Reflect.apply(originalPost, port, [message, ...rest]);
                    };
                    port.addEventListener('message', (message: MessageEvent<unknown>) => {
                        const data = record(message.data);
                        if (data?.type === 'stopped' && typeof data.publishedSampleCount === 'number') {
                            event('worklet-stopped-ack', { publishedFrames: data.publishedSampleCount });
                        }
                    });
                    const timer = setInterval(() => {
                        if (state.stopSent) {
                            return;
                        }
                        const observation = observe();
                        if (observation.recording?.sampleZeroContextFrame === null || !observation.recording) {
                            return;
                        }
                        state.firstFrame ??= observation;
                        state.samples.push(observation);
                    }, 50);
                    port.addEventListener('message', (message: MessageEvent<unknown>) => {
                        if (record(message.data)?.type === 'stopped') {
                            clearInterval(timer);
                        }
                    });
                    return node;
                },
            })
        );
        const OriginalWorker = window.Worker;
        Reflect.set(
            window,
            'Worker',
            new Proxy(OriginalWorker, {
                construct(target, args) {
                    const worker = Reflect.construct(target, args) as Worker;
                    if (!String(args[0]).includes('recordingWorker')) {
                        return worker;
                    }
                    const originalPost = worker.postMessage;
                    worker.postMessage = (
                        message: unknown,
                        ...rest: [transferOrOptions?: Transferable[] | StructuredSerializeOptions]
                    ): void => {
                        const data = record(message);
                        if (data?.type === 'stop' && typeof data.expectedFinalSampleCount === 'number') {
                            event('send-worker-stop', { publishedFrames: data.expectedFinalSampleCount });
                        }
                        Reflect.apply(originalPost, worker, [message, ...rest]);
                    };
                    worker.addEventListener('message', (message: MessageEvent<unknown>) => {
                        const data = record(message.data);
                        if (data?.type === 'wav') {
                            const buffer = data.buffer;
                            event('worker-wav', {
                                wavBytes: buffer instanceof ArrayBuffer ? buffer.byteLength : undefined,
                                sampleZeroContextFrame:
                                    typeof data.sampleZeroContextFrame === 'number'
                                        ? data.sampleZeroContextFrame
                                        : undefined,
                                sampleRate: typeof data.sampleRate === 'number' ? data.sampleRate : undefined,
                            });
                        }
                    });
                    return worker;
                },
            })
        );
        document.addEventListener(
            'click',
            (click) => {
                const target = click.target instanceof Element ? click.target : null;
                if (target?.closest('[data-testid="transport-stop"]')) {
                    event('capture-stop-click');
                }
                if (target?.closest('[data-testid="transport-play"]')) {
                    event('capture-pause-click');
                }
            },
            true
        );
    });
}

export async function currentPunchRecordingClock(page: Page): Promise<LivePunchRecordingClock> {
    return page.evaluate(() => {
        const host = window as DiagnosticWindow;
        const state = host.__punchRecordingClockWitness;
        const read = host.__readPunchRecordingClock;
        if (!state?.admission || !read) {
            throw new Error('Punch recording clock witness is not bound');
        }
        return { ...read(), admission: state.admission };
    });
}

export async function readPunchRecordingClockWitness(page: Page): Promise<PunchRecordingClockWitness> {
    return page.evaluate(() => {
        const state = (window as DiagnosticWindow).__punchRecordingClockWitness;
        if (!state?.admission) {
            throw new Error('Punch recording clock witness is not bound');
        }
        const { admission, firstFrame, samples, events, readDiagnostics } = state;
        return { admission, firstFrame, samples, events, readDiagnostics };
    });
}
