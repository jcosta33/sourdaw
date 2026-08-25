/**
 * GrandBouleNode - one control surface over two transport designs.
 *
 * **Live** (`createWorkerRingTransport`):
 *   Main thread  →  Web Worker (WASM engine)  →  SAB ring buffer  →  AudioWorklet (consumer)
 *
 * The physical-modeling engine runs on a Web Worker that renders
 * ahead into a SharedArrayBuffer. The AudioWorklet `process()` just copies from
 * the ring — microseconds of work, and an overload starves this device's own
 * ring instead of missing the graph's deadline and glitching every track.
 *
 * **Inline offline** (`createInlineWorkletTransport`):
 *   Main thread  →  AudioWorklet (WASM engine)
 *
 * An `OfflineAudioContext` has no system-level audio callback and therefore no
 * load value and no underrun (Web Audio §2.6): a slow worklet makes the render
 * slower, not worse. There is no deadline for the ring to protect, and its
 * back-pressure and macrotask pacing are what collapse an export into 97–99 %
 * silence (INVENTORY-device-clock-parity G-1) — the consumer cannot wait for the
 * producer, because `Atomics.wait` is banned in `AudioWorkletGlobalScope`.
 *
 * The split is the shape every serious plugin API formalises: VST3
 * `ProcessSetup::processMode`, CLAP `clap_plugin_render`. Both transports run the
 * same engine and the same control surface — see `worklets/grandBouleEngineCore`,
 * which both hosts import and neither may re-implement.
 *
 * Every method below is written once and posts through `transport.post`.
 */

import { raceAbortSignal } from '#/infra/audioWorklet/raceAbortSignal';
import { createReadyHandshake, ensureWorkletRegistered, fetchWasmModule } from '#/infra/audioWorklet/workletInitShared';

import {
    GRAND_BOULE_CONTROL_HEADER_BYTES,
    GRAND_BOULE_CONTROL_INT_COUNT,
    GRAND_BOULE_SLEEP_HEAD_IDX,
    GRAND_BOULE_SYNC_INT_COUNT,
} from '../models/GrandBouleRingProtocol';
import grandBouleOfflineProcessorUrl from '../worklets/grandBouleOfflineProcessor.ts?worker&url';
import grandBouleProcessorUrl from '../worklets/grandBouleProcessor.ts?worker&url';

import { dropoutCounters } from './dropoutCounter';
import { requireSharedArrayBuffer } from './pluginHostingErrors';

const DEFAULT_WASM_URL = '/wasm/daw-dsp/daw_dsp_bg.wasm';
export const GRAND_BOULE_MAX_LIVE_SAMPLE_RATE = 48_000;

/** Ring buffer: 8192 stereo frames ≈ 170 ms at 48 kHz. */
const RING_FRAMES = 8192;
const SAB_BYTES = GRAND_BOULE_CONTROL_HEADER_BYTES + RING_FRAMES * 2 * Float32Array.BYTES_PER_ELEMENT;
let nextWorkerInitId = 0;
const RUNTIME_HEALTH_CHECK_TIMEOUT_MS = 2000;

export type GrandBouleNodeResult = {
    workletNode: AudioWorkletNode;
    noteOn: (midiNote: number, velocity: number, sampleFrame?: number, channel?: number) => void;
    noteOff: (midiNote: number, sampleFrame?: number, releaseVelocity?: number, channel?: number) => void;
    /**
     * MPE per-note expression (audit MD-2). Grand Boule sounds
     * `bendSemitones` only — its ringing modal strings are retuned in
     * place; `pressure` and `slide` have no counterpart on a struck string
     * and are dropped at the engine. The expression registry advertises
     * pitch bend alone for this device, so the editor never offers them.
     */
    noteExpression: (
        midiNote: number,
        channel: number,
        bendSemitones: number,
        pressure: number,
        slide: number,
        sampleFrame?: number
    ) => void;
    setParam: (name: string, value: number, sampleFrame?: number) => void;
    acceptsScheduledParam?: (name: string) => boolean;
    scheduleParam?: (name: string, segments: readonly OfflineAutomationSegment[]) => void;
    setSustain: (position: number) => void;
    setUnaCorda: (engaged: boolean) => void;
    setSostenuto: (engaged: boolean) => void;
    noteOnMidi2: (midiNote: number, velocity16bit: number, pitchOffsetQ24: number) => void;
    setTemperament: (index: number) => void;
    loadAttackClip: (key: number, samples: Float32Array) => void;
    allNotesOff: () => void;
    setBypass: (bypassed: boolean) => void;
    connect: (dest: AudioNode) => void;
    disconnect: () => void;
    destroy: () => void;
    ready: Promise<Record<string, unknown>>;
    /** Confirms that an offline processor did not fault in its final render quantum. */
    runtimeHealthCheck?: () => Promise<void>;
};

type OfflineAutomationSegment = {
    startFrame: number;
    endFrame: number;
    startValue: number;
    endValue: number;
};

/** Offline scheduling capabilities; values are stable capability IDs, not WASM ordinals. */
export const GRAND_BOULE_AUTOMATION_PARAM_IDS = {
    masterGain: 0,
    soundboardSend: 1,
    sympatheticSend: 2,
    lidPosition: 3,
    micPosition: 4,
} as const;

function acceptsGrandBouleAutomation(name: string): boolean {
    return Object.hasOwn(GRAND_BOULE_AUTOMATION_PARAM_IDS, name);
}

function validAutomationSegments(segments: readonly OfflineAutomationSegment[]): boolean {
    if (segments.length === 0) {
        return false;
    }
    let previousEndFrame = 0;
    for (const segment of segments) {
        if (
            !Number.isInteger(segment.startFrame) ||
            !Number.isInteger(segment.endFrame) ||
            segment.startFrame < previousEndFrame ||
            segment.endFrame < segment.startFrame ||
            !Number.isFinite(segment.startValue) ||
            !Number.isFinite(segment.endValue)
        ) {
            return false;
        }
        previousEndFrame = segment.endFrame;
    }
    return true;
}

export function isGrandBouleDevice(deviceType: string): boolean {
    return deviceType === 'grand-boule';
}

/**
 * How one Grand Boule node reaches its engine.
 *
 * The node factory below owns the whole control surface and knows nothing else
 * about the engine's whereabouts: two implementations, one seam, so a guard or a
 * range check added to a method is added once for both hosts.
 */
type GrandBouleTransport = {
    /** The node in the audio graph, whichever side of the seam produces its samples. */
    workletNode: AudioWorkletNode;
    /** Deliver one control message to wherever the engine actually lives. */
    post: (msg: Record<string, unknown>) => void;
    /** Resolves once the engine can render; rejects if any side fails to come up. */
    ready: Promise<Record<string, unknown>>;
    /** Round-trips terminal state from an offline worklet after rendering. */
    runtimeHealthCheck?: () => Promise<void>;
    /** Release the transport's own resources. Graph disconnection is the caller's. */
    destroy: () => void;
};

type CreateGrandBouleTransportInput = {
    ctx: BaseAudioContext;
    wasmModule: WebAssembly.Module;
    onFault?: (message: string) => void;
};

function readHandshakeError(event: MessageEvent, fallback: string): Error {
    const data: unknown = event.data;
    if (data !== null && typeof data === 'object' && 'type' in data && data.type === 'error' && 'message' in data) {
        const message: unknown = data.message;
        if (typeof message === 'string') {
            return new Error(message);
        }
    }
    return new Error(fallback);
}

function reportsTransportError(event: MessageEvent): boolean {
    const data: unknown = event.data;
    return data !== null && typeof data === 'object' && 'type' in data && data.type === 'error';
}

type RuntimeHealthResponse = { requestId: number; error: string | null };

function readRuntimeHealthResponse(event: MessageEvent): RuntimeHealthResponse | null {
    const data: unknown = event.data;
    if (
        data === null ||
        typeof data !== 'object' ||
        !('type' in data) ||
        data.type !== 'runtimeHealth' ||
        !('requestId' in data) ||
        typeof data.requestId !== 'number' ||
        !('error' in data) ||
        (data.error !== null && typeof data.error !== 'string')
    ) {
        return null;
    }
    return { requestId: data.requestId, error: data.error };
}

/**
 * Live transport: engine in a Worker, samples through a SharedArrayBuffer ring,
 * worklet as consumer. Behaviour is exactly as it has always been.
 */
function createWorkerRingTransport({ ctx, wasmModule, onFault }: CreateGrandBouleTransportInput): GrandBouleTransport {
    // `requireSharedArrayBuffer` guards this transport and is called by the
    // factory *before* its awaits, not here: by the time this runs the context
    // has been resumed and the wasm downloaded, which is exactly the work the
    // guard exists to avoid paying. The allocations below are what it protects.
    const node = new AudioWorkletNode(ctx, 'grand-boule-processor', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: 'explicit',
    });

    // Create SAB ring buffer shared between Worker and AudioWorklet.
    // Requires cross-origin isolation (COOP + COEP headers) — guarded above.
    const sab = new SharedArrayBuffer(SAB_BYTES);
    const controls = new Int32Array(sab, 0, GRAND_BOULE_CONTROL_INT_COUNT);
    // Distinguish the not-yet-initialised producer from a producer that has
    // deliberately gone to sleep at frame zero.
    Atomics.store(controls, GRAND_BOULE_SLEEP_HEAD_IDX, -1);

    // A seqlocked consumer-clock snapshot: the worklet publishes an absolute
    // context frame beside the ring read head observed at that frame. The worker
    // can then unwrap its signed write head relative to the matching read head,
    // including when either cursor crosses the Int32 boundary. Separate from the
    // ring SAB so the ring layout stays exactly as the SPSC proofs describe it.
    const syncSab = new SharedArrayBuffer(GRAND_BOULE_SYNC_INT_COUNT * Int32Array.BYTES_PER_ELEMENT);

    // Create the engine Worker.
    const engineWorker = new Worker(new URL('../workers/grandBouleEngineWorker.ts', import.meta.url), {
        type: 'module',
    });

    // Two sides have to come up, and both of them have to be waited for.
    //
    // `ready` used to be the engine worker's handshake alone. The worklet does
    // reply to its own `init` — `grandBouleProcessor` posts `{type:'ready'}` once
    // it has mapped the ring — but nothing listened, so a caller could await
    // `ready` and start a render against a worklet still holding no ring. Its
    // `process()` returns at the not-ready guard before it can even detect an
    // underrun, so the outcome is a completely silent export that reports zero
    // dropouts: the one failure the dropout counters exist to make visible.
    const workerHandshake = createReadyHandshake({ pluginName: 'GrandBouleNode engine worker' });
    const workletHandshake = createReadyHandshake({ pluginName: 'GrandBouleNode worklet' });

    let stopped = false;
    let transportReady = false;
    const stopTransport = (): void => {
        if (stopped) {
            return;
        }
        stopped = true;
        node.onprocessorerror = null;
        engineWorker.onerror = null;
        engineWorker.onmessageerror = null;
        node.port.close();
        engineWorker.postMessage({ type: 'stop' });
        engineWorker.terminate();
    };
    const stopFailedTransport = (error: Error): void => {
        if (stopped) {
            return;
        }
        const failedAfterReady = transportReady;
        // Reject both halves. If one side already completed, rejecting only that
        // handshake leaves Promise.all waiting for the other side until its
        // timeout even though this transport is already irrecoverable.
        workerHandshake.reject(error);
        workletHandshake.reject(error);
        // No producer remains to refill the ring. Stop the consumer as well so
        // a post-ready failure cannot leave a permanent worklet draining silence.
        node.port.postMessage({ type: 'engineError' });
        stopTransport();
        if (failedAfterReady) {
            console.error('[GrandBouleNode] Transport failed after initialization:', error);
            try {
                onFault?.(error.message);
            } catch (callbackError) {
                console.error('[GrandBouleNode] Runtime-failure callback failed:', callbackError);
            }
        }
    };
    engineWorker.onmessage = (event: MessageEvent) => {
        const outcome = workerHandshake.onMessage(event);
        if (outcome === 'error' || reportsTransportError(event)) {
            stopFailedTransport(readHandshakeError(event, 'GrandBouleNode engine worker failed during initialization'));
        }
    };
    engineWorker.onerror = (event: ErrorEvent) => {
        const message = event.message || 'GrandBouleNode engine worker crashed during initialization';
        stopFailedTransport(new Error(message));
    };
    engineWorker.onmessageerror = () => {
        stopFailedTransport(new Error('GrandBouleNode engine worker sent an unreadable initialization message'));
    };
    node.port.onmessage = (event: MessageEvent) => {
        const outcome = workletHandshake.onMessage(event);
        if (outcome === 'error' || reportsTransportError(event)) {
            stopFailedTransport(readHandshakeError(event, 'GrandBouleNode worklet failed during initialization'));
        }
    };
    node.onprocessorerror = () => {
        stopFailedTransport(new Error('GrandBouleNode worklet processor failed'));
    };

    // Init the worklet straight away rather than from the worker's ready handler.
    // Nothing in this payload comes from the worker — the ring, the dropout
    // counters and the sync slot all exist already — so the sequencing bought
    // nothing and cost both handshakes an honest timeout: the worklet's clock
    // would have started while it was still waiting for the worker's turn. The
    // worklet reads an empty ring as an underrun and emits silence, which is what
    // it does for the first few quanta of every live session anyway.
    //
    // The dropout counters travel with it so ring starvation is tallied instead
    // of silently producing silence (audit RT-10).
    //
    // `countPreRollStarvation` is false here because this transport is now only
    // ever built for a live context. It used to be set for an offline render, to
    // make a ring that never delivered visible in the dropout tally; offline no
    // longer has a ring, and the starvation it was counting is what the inline
    // transport removes rather than reports.
    node.port.postMessage({
        type: 'init',
        sab,
        dropoutSab: dropoutCounters.getSab(),
        syncSab,
        countPreRollStarvation: false,
    });

    // Callers read the worker's payload; the worklet ack carries only its own
    // arrival. `Promise.all` subscribes to both, so whichever side fails first
    // rejects `ready` and the other's later rejection is still handled.
    const ready = Promise.all([workerHandshake.promise, workletHandshake.promise]).then(
        ([workerData]) => {
            transportReady = true;
            return workerData;
        },
        (error: unknown) => {
            const failure = error instanceof Error ? error : new Error(String(error));
            stopFailedTransport(failure);
            throw failure;
        }
    );

    // Send the precompiled WASM module + SAB to the engine worker. `contextFrame`
    // anchors the engine's frame 0 on the host clock for the window before the
    // worklet has run a block.
    engineWorker.postMessage({
        type: 'init',
        initId: ++nextWorkerInitId,
        wasmModule,
        sab,
        sampleRate: ctx.sampleRate,
        syncSab,
        contextFrame: Math.round(ctx.currentTime * ctx.sampleRate),
    });

    return {
        workletNode: node,
        post: (msg) => {
            engineWorker.postMessage(msg);
        },
        ready,
        destroy: stopTransport,
    };
}

/**
 * Offline transport: the engine runs inside the worklet, and there is nothing
 * else. No Worker, no ring SAB, no sync plane, no dropout counters, and no
 * `requireSharedArrayBuffer` — none of them has anything to protect in a context
 * with no deadline, and each one is a way for an export to come out silent.
 *
 * One handshake, because there is one side to come up.
 */
function createInlineWorkletTransport({
    ctx,
    wasmModule,
    onFault,
}: CreateGrandBouleTransportInput): GrandBouleTransport {
    const node = new AudioWorkletNode(ctx, 'grand-boule-offline-processor', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: 'explicit',
        processorOptions: { wasmModule },
    });

    const handshake = createReadyHandshake({ pluginName: 'GrandBouleNode offline worklet' });
    let stopped = false;
    let transportReady = false;
    let terminalError: Error | null = null;
    let nextHealthCheckId = 0;
    const pendingHealthChecks = new Map<
        number,
        { resolve: () => void; reject: (error: Error) => void; timeout: ReturnType<typeof setTimeout> }
    >();
    const stopTransport = (): void => {
        if (stopped) {
            return;
        }
        stopped = true;
        const stopError = terminalError ?? new Error('GrandBouleNode offline transport stopped');
        for (const pending of pendingHealthChecks.values()) {
            clearTimeout(pending.timeout);
            pending.reject(stopError);
        }
        pendingHealthChecks.clear();
        node.onprocessorerror = null;
        node.port.close();
    };
    const stopFailedTransport = (error: Error): void => {
        if (stopped) {
            return;
        }
        terminalError = error;
        const failedAfterReady = transportReady;
        handshake.reject(error);
        stopTransport();
        if (failedAfterReady) {
            console.error('[GrandBouleNode] Offline transport failed after initialization:', error);
            try {
                onFault?.(error.message);
            } catch (callbackError) {
                console.error('[GrandBouleNode] Runtime-failure callback failed:', callbackError);
            }
        }
    };
    node.port.onmessage = (event: MessageEvent) => {
        const health = readRuntimeHealthResponse(event);
        if (health) {
            const pending = pendingHealthChecks.get(health.requestId);
            if (!pending) {
                return;
            }
            pendingHealthChecks.delete(health.requestId);
            clearTimeout(pending.timeout);
            if (health.error !== null) {
                const error = new Error(health.error);
                pending.reject(error);
                stopFailedTransport(error);
            } else {
                pending.resolve();
            }
            return;
        }
        const outcome = handshake.onMessage(event);
        if (outcome === 'error' || reportsTransportError(event)) {
            stopFailedTransport(
                readHandshakeError(event, 'GrandBouleNode offline worklet failed during initialization')
            );
        }
    };
    node.onprocessorerror = () => {
        stopFailedTransport(new Error('GrandBouleNode offline worklet processor failed'));
    };
    node.port.postMessage({ type: 'init' });

    const ready = handshake.promise.then(
        (data) => {
            transportReady = true;
            return data;
        },
        (error: unknown) => {
            const failure = error instanceof Error ? error : new Error(String(error));
            stopFailedTransport(failure);
            throw failure;
        }
    );

    const runtimeHealthCheck = (): Promise<void> => {
        if (terminalError) {
            return Promise.reject(terminalError);
        }
        if (stopped) {
            return Promise.reject(new Error('GrandBouleNode offline transport stopped before its health check'));
        }

        const requestId = ++nextHealthCheckId;
        return new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
                pendingHealthChecks.delete(requestId);
                const error = new Error('GrandBouleNode offline worklet health check timed out');
                reject(error);
                stopFailedTransport(error);
            }, RUNTIME_HEALTH_CHECK_TIMEOUT_MS);
            pendingHealthChecks.set(requestId, { resolve, reject, timeout });
            try {
                node.port.postMessage({ type: 'runtimeHealthCheck', requestId });
            } catch (error) {
                clearTimeout(timeout);
                pendingHealthChecks.delete(requestId);
                const failure = error instanceof Error ? error : new Error(String(error));
                reject(failure);
                stopFailedTransport(failure);
            }
        });
    };

    return {
        workletNode: node,
        post: (msg) => {
            node.port.postMessage(msg);
        },
        ready,
        runtimeHealthCheck,
        destroy: stopTransport,
    };
}

export async function createGrandBouleNode(
    ctx: BaseAudioContext,
    wasmUrl?: string,
    onFault?: (message: string) => void,
    signal?: AbortSignal
): Promise<GrandBouleNodeResult> {
    // Branching on the context type rather than on the presence of a DOM global,
    // the same way `faustDeviceFactory` picks its scheduler. This branch already
    // existed here and only flipped a dropout-counting flag; it now decides which
    // engine host is built, which is the thing the flag was compensating for.
    const isOfflineRender = typeof OfflineAudioContext !== 'undefined' && ctx instanceof OfflineAudioContext;

    if (!isOfflineRender && ctx.sampleRate > GRAND_BOULE_MAX_LIVE_SAMPLE_RATE) {
        throw new RangeError(
            `Grand Boule live playback supports sample rates up to ${String(GRAND_BOULE_MAX_LIVE_SAMPLE_RATE)} Hz; received ${String(ctx.sampleRate)} Hz`
        );
    }

    // Fail fast, before any AudioContext / worklet / WASM work — the ordering
    // every sibling factory keeps, and the reason it matters here: past this
    // point the caller has resumed the context, permanently registered a
    // processor module on it and downloaded 554 KB of wasm, and an abort landing
    // in any of those awaits would replace the typed error `buildDeviceChain`
    // maps to the cross-origin-isolation notification with an `AbortError`.
    //
    // Only the live transport needs it: an offline render has no shared memory
    // at all, and refusing there would make a project unexportable over a
    // capability the render never touches.
    if (!isOfflineRender) {
        requireSharedArrayBuffer('Grand Boule');
    }

    if (ctx instanceof AudioContext && ctx.state === 'suspended') {
        await raceAbortSignal(ctx.resume(), signal);
    }

    const processorUrl = isOfflineRender ? grandBouleOfflineProcessorUrl : grandBouleProcessorUrl;

    await raceAbortSignal(ensureWorkletRegistered(ctx, processorUrl), signal);
    const wasmLease = await raceAbortSignal(
        fetchWasmModule({ ctx, bundleId: 'daw-dsp', url: wasmUrl ?? DEFAULT_WASM_URL, signal }),
        signal
    );

    signal?.throwIfAborted();

    let transport: GrandBouleTransport;
    try {
        if (isOfflineRender) {
            transport = createInlineWorkletTransport({ ctx, wasmModule: wasmLease.module, onFault });
        } else {
            transport = createWorkerRingTransport({ ctx, wasmModule: wasmLease.module, onFault });
        }
        wasmLease.commit();
    } catch (error) {
        wasmLease.release();
        throw error;
    }

    const node = transport.workletNode;
    let bypassed = false;
    let destroyed = false;

    /** Post a control message to wherever this node's engine lives. */
    const post = (msg: Record<string, unknown>): void => {
        transport.post(msg);
    };

    return {
        workletNode: node,
        noteOn(midiNote: number, velocity: number, sampleFrame?: number, channel?: number) {
            if (!bypassed) {
                post({ type: 'noteOn', midiNote, velocity, sampleFrame, channel });
            }
        },
        // `channel` narrows the release to one MPE member channel; omit it
        // and every voice at that pitch is released, as before.
        noteOff(midiNote: number, sampleFrame?: number, releaseVelocity?: number, channel?: number) {
            post({
                type: 'noteOff',
                midiNote,
                sampleFrame,
                releaseVelocity: releaseVelocity ?? 0,
                channel,
            });
        },
        noteExpression(
            midiNote: number,
            channel: number,
            bendSemitones: number,
            pressure: number,
            slide: number,
            sampleFrame?: number
        ) {
            if (midiNote < 0 || midiNote > 127) {
                return;
            }
            if (!Number.isFinite(bendSemitones) || !Number.isFinite(pressure) || !Number.isFinite(slide)) {
                return;
            }
            post({
                type: 'noteExpression',
                midiNote,
                channel,
                bendSemitones,
                pressure,
                slide,
                sampleFrame,
            });
        },
        setParam(name: string, value: number, sampleFrame?: number) {
            if (Number.isFinite(value)) {
                post({ type: 'param', name, value, sampleFrame });
            }
        },
        acceptsScheduledParam(name: string) {
            return isOfflineRender && acceptsGrandBouleAutomation(name);
        },
        scheduleParam(name: string, segments: readonly OfflineAutomationSegment[]) {
            if (isOfflineRender && acceptsGrandBouleAutomation(name) && validAutomationSegments(segments)) {
                post({ type: 'paramAutomation', name, segments });
            }
        },
        setSustain(position: number) {
            post({ type: 'sustain', position });
        },
        setUnaCorda(engaged: boolean) {
            post({ type: 'unaCorda', engaged });
        },
        setSostenuto(engaged: boolean) {
            post({ type: 'sostenuto', engaged });
        },
        noteOnMidi2(midiNote: number, velocity16bit: number, pitchOffsetQ24: number) {
            if (!bypassed) {
                post({ type: 'noteOnMidi2', midiNote, velocity16bit, pitchOffsetQ24 });
            }
        },
        setTemperament(index: number) {
            post({ type: 'temperament', index });
        },
        loadAttackClip(key: number, samples: Float32Array) {
            const buf = new Float32Array(samples);
            post({ type: 'loadAttackClip', key, samples: buf });
        },
        allNotesOff() {
            post({ type: 'allNotesOff' });
        },
        setBypass(state: boolean) {
            // Only gates *new* noteOn. Releasing voices already held on bypass
            // entry is owned by TrackNode.updateBypass via controller.allNotesOff
            // (wired above) — no in-node post, or the release would run twice.
            bypassed = state;
        },
        connect(dest: AudioNode) {
            node.connect(dest);
        },
        disconnect() {
            try {
                node.disconnect();
            } catch (error) {
                console.error('[GrandBouleNode] Disconnect failed:', error);
            }
        },
        destroy() {
            if (destroyed) {
                return;
            }
            destroyed = true;
            try {
                node.disconnect();
            } catch (error) {
                console.error('[GrandBouleNode] Disconnect failed during destroy:', error);
            }
            transport.destroy();
        },
        ready: transport.ready,
        runtimeHealthCheck: transport.runtimeHealthCheck,
    };
}
