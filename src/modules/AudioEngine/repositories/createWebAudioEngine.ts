import {
    DEFAULT_AUDIO_LATENCY_PROFILE,
    getAudioContextLatencyHint,
    readStoredAudioLatencyProfile,
    type AudioLatencyProfile,
} from '#/infra/audioContext/audioLatencyProfile';
import { logger } from '#/infra/logger/appLogger';
import { hasSharedArrayBuffer } from '#/utils/capabilities';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { createAdjustmentLayerRuntime, type AdjustmentLayerRuntime } from '../engine/AdjustmentLayerRuntime';
import { BusNode } from '../engine/BusNode';
import { createDeviceReadinessDiagnostics } from '../engine/deviceReadinessDiagnostics';
import { dropoutCounters } from '../engine/dropoutCounter';
import { TrackNode } from '../engine/TrackNode';
import {
    type RuntimeGraphDelta,
    type RuntimeGraphDeltaNode,
    type RuntimeGraphDeltaResult,
} from '../models/RuntimeGraphDelta';
import bitcrusherRateProcessorUrl from '../services/bitcrusherRateProcessor.ts?worker&url';
import { compileRuntimeGraphDelta } from '../services/compileRuntimeGraphDelta';
import meteringProcessorUrl from '../services/meteringProcessor.ts?worker&url';
import recordingProcessorUrl from '../services/recordingProcessor.ts?worker&url';

import type {
    AdjustmentLayerTickInput,
    AudioEngine,
    AudioEngineDiagnostics,
    AudioEngineHealth,
    AudioEnginePlaybackStats,
    AudioProcessorLifecycleState,
    AudioEngineState,
    BusStrip,
    BuiltinDeviceNode,
    SendNode,
    ToasterDeviceControls,
    TrackChannelStrip,
} from '../models/AudioEngineState';

type NoopMeterNode = {
    connect(): void;
    disconnect(): void;
    port: { postMessage(message: unknown): void };
};

type SidechainConnection = {
    sourceTrackId: string;
    targetTrackId: string;
    targetDeviceId: string;
    sourceNode: AudioNode;
    /** FX-5 — key alignment line sitting between the tap and the route gain. */
    keyDelayNode: DelayNode;
    /** Last value written to {@link keyDelayNode}, so a per-tick refresh that
     *  resolves the same alignment schedules nothing at all. */
    appliedKeyDelaySec: number;
    gainNode: GainNode;
};

/** Resolves the seconds of key delay a wired sidechain route currently needs.
 *  Supplied by the use-case layer (`refreshSidechainAlignment`) so the engine
 *  never reaches into project state for it. */
export type SidechainKeyDelayResolver = (route: {
    sourceTrackId: string;
    targetTrackId: string;
    targetDeviceId: string;
}) => number;

type ToasterPadRoute = {
    toasterParentTrackId: string;
    padIndex: number;
    destinationNode: GainNode | null;
    controls: ToasterDeviceControls | null;
};

type ChromeAudioPlaybackStats = AudioEnginePlaybackStats & {
    resetLatency(): void;
    toJSON(): object;
};

function isChromeAudioPlaybackStats(value: unknown): value is ChromeAudioPlaybackStats {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    return (
        'underrunDuration' in value &&
        typeof value.underrunDuration === 'number' &&
        'underrunEvents' in value &&
        typeof value.underrunEvents === 'number' &&
        'totalDuration' in value &&
        typeof value.totalDuration === 'number' &&
        'averageLatency' in value &&
        typeof value.averageLatency === 'number' &&
        'minimumLatency' in value &&
        typeof value.minimumLatency === 'number' &&
        'maximumLatency' in value &&
        typeof value.maximumLatency === 'number' &&
        'resetLatency' in value &&
        typeof value.resetLatency === 'function' &&
        'toJSON' in value &&
        typeof value.toJSON === 'function'
    );
}

function getChromePlaybackStats(context: AudioContext): ChromeAudioPlaybackStats {
    const stats = 'playbackStats' in context ? context.playbackStats : undefined;
    if (!isChromeAudioPlaybackStats(stats)) {
        throw new Error('Audio diagnostics require AudioContext.playbackStats from current stable Chrome.');
    }
    return stats;
}

function readPlaybackStats(context: AudioContext): AudioEnginePlaybackStats {
    const stats = getChromePlaybackStats(context);
    return {
        underrunDuration: stats.underrunDuration,
        underrunEvents: stats.underrunEvents,
        totalDuration: stats.totalDuration,
        averageLatency: stats.averageLatency,
        minimumLatency: stats.minimumLatency,
        maximumLatency: stats.maximumLatency,
    };
}

type DeviceRuntimeResources = {
    audioNodes: number;
    audioWorkletProcessors: number;
    workers: number;
};

function countDeviceRuntimeResources(device: BuiltinDeviceNode): DeviceRuntimeResources {
    const ownedAudioNodes = new Set([device.inputNode, device.outputNode, ...device.nodes]);
    let audioWorkletProcessors = 0;
    for (const node of ownedAudioNodes) {
        if (node instanceof AudioWorkletNode) {
            audioWorkletProcessors++;
        }
    }
    return { audioNodes: ownedAudioNodes.size, audioWorkletProcessors, workers: device.workerInstances ?? 0 };
}

function createEmptyGraphSlotResourcesByLoadState(): AudioEngineDiagnostics['graph']['graphSlotResourcesByLoadState'] {
    return {
        ready: { audioNodes: 0, audioWorkletProcessors: 0, workers: 0 },
        pending: { audioNodes: 0, audioWorkletProcessors: 0, workers: 0 },
        failed: { audioNodes: 0, audioWorkletProcessors: 0, workers: 0 },
    };
}

function addDeviceResources(target: DeviceRuntimeResources, resources: DeviceRuntimeResources): void {
    target.audioNodes += resources.audioNodes;
    target.audioWorkletProcessors += resources.audioWorkletProcessors;
    target.workers += resources.workers;
}

function addCountByType(counts: Map<string, number>, type: string, count: number): void {
    if (count === 0) {
        return;
    }
    counts.set(type, (counts.get(type) ?? 0) + count);
}

function toSortedCountRecord(counts: Map<string, number>): Record<string, number> {
    return Object.fromEntries([...counts].sort(([left], [right]) => left.localeCompare(right)));
}

/**
 * Transport SharedArrayBuffer layout (one 64-byte buffer shared with worklet
 * readers, e.g. {@link kneadProcessor}).
 *
 * The seven transport fields are read as `Float64Array` slots 0–6 (bytes 0–55);
 * a single 32-bit sequence counter lives at `Int32Array` index 14 (bytes 56–59,
 * the otherwise-unused 8th f64 slot). The counter guards the seven fields with a
 * seqlock: the writer makes it odd before the field writes and even after, and a
 * reader retries while it is odd or changes across the read — so a worklet never
 * observes a snapshot torn across the seven non-atomic field writes.
 *
 * `Atomics` requires an integer-typed view, hence the separate `Int32Array` for
 * the counter; the data fields stay `Float64Array` (they carry fractional beats
 * and tempo). Index/offset names are shared with the reader so both sides agree.
 */
const TRANSPORT_F64 = {
    beat: 0,
    tempo: 1,
    sampleRate: 2,
    loopStart: 3,
    loopEnd: 4,
    isPlaying: 5,
    isLooping: 6,
} as const;

/** Byte length of the transport SAB: 8 f64 slots (7 data + 1 holding the seq counter). */
const TRANSPORT_SAB_BYTES = 64;

/** `Int32Array` index of the seqlock sequence counter (byte offset 56, the 8th f64 slot). */
const TRANSPORT_SEQ_I32 = 14;

/**
 * Equal-time crossfade duration (seconds) for a live pre/post-fader send-tap
 * handoff. The old tap's send gain ramps to 0 while a freshly-built gain on the
 * new tap ramps up over the same window, so the bus never sees the block of
 * silence a hard disconnect/reconnect produced. ~10ms is short enough to feel
 * instant yet long enough to span a render quantum at any sample rate.
 */
const SEND_TAP_CROSSFADE_SECONDS = 0.01;

/** Extra margin (seconds) before the faded-out old send node is disconnected. */
const SEND_TAP_CROSSFADE_TEARDOWN_MARGIN_SECONDS = 0.02;

/**
 * Ceiling (seconds) on a sidechain key alignment line. PDC values are single-
 * digit milliseconds to low tens; a `DelayNode` allocates its ring buffer from
 * this maximum, so it is generous enough that no realistic chain is clipped and
 * small enough that the buffer stays trivial.
 */
const SIDECHAIN_KEY_MAX_DELAY_SECONDS = 1;

/** Glide span (seconds) for a key-alignment change — one scheduler grain, the
 *  same span the automation ramps use. Stepping `delayTime` resamples the key
 *  and clicks; a short a-rate ramp does not. */
const SIDECHAIN_KEY_DELAY_RAMP_SECONDS = 0.01;

/** Below this (seconds, well under a sample at any rate) a re-resolved key
 *  alignment counts as unchanged and schedules nothing — the alignment refresh
 *  runs every scheduler tick and must not churn AudioParam events. */
const SIDECHAIN_KEY_DELAY_EPSILON_SECONDS = 1e-6;

/**
 * Builds a silent stand-in for {@link AudioContext} from an
 * {@link OfflineAudioContext} (which never produces sound and shares the
 * node-factory surface the fallback path uses). The handful of `AudioContext`
 * members `OfflineAudioContext` lacks are stubbed so the result is a genuine,
 * structurally-checked `AudioContext` — replacing the former
 * `as BaseAudioContext as AudioContext` double-assertion, which silenced the
 * type checker rather than satisfying it.
 */
function createNoopAudioContext(): AudioContext {
    const offline = new OfflineAudioContext(2, 1, 44100);
    function reject(): never {
        throw new Error('AudioEngine is in fallback mode — no AudioContext is available.');
    }
    const shim: AudioContext = Object.assign(offline, {
        baseLatency: 0,
        outputLatency: 0,
        close: () => Promise.resolve(),
        // `OfflineAudioContext.suspend` requires a `suspendTime` argument, so its
        // signature is wider than `AudioContext.suspend()`. Override both lifecycle
        // methods with the no-op, no-arg forms the fallback path expects.
        resume: () => Promise.resolve(),
        suspend: () => Promise.resolve(),
        createMediaElementSource: reject,
        createMediaStreamSource: reject,
        createMediaStreamDestination: reject,
        getOutputTimestamp: () => ({ contextTime: 0, performanceTime: 0 }),
    });
    return shim;
}

class AudioEngineImpl implements AudioEngine {
    public context!: AudioContext;
    public masterGainNode!: GainNode;
    public masterAnalyser!: AnalyserNode;
    public masterMeterNode: AudioWorkletNode | NoopMeterNode | undefined;

    private trackNodes = new Map<string, TrackNode>();
    private busNodes = new Map<string, BusNode>();
    private sendNodes = new Map<string, SendNode>();
    private sidechainConnections = new Map<string, SidechainConnection>();
    private toasterPadRoutes = new Map<string, ToasterPadRoute>();
    /**
     * Sidechain routes requested while the engine could not wire them (fallback
     * mode — no live AudioContext). Keyed by `${sourceTrackId}→${targetDeviceId}`
     * so an unwire request can cancel a still-pending wire. These are replayed
     * the next time wireSidechainRoute runs outside fallback mode, so a route
     * requested before the engine was usable is not silently lost (the store
     * keeps the route but the live graph would otherwise diverge with no
     * recovery).
     */
    private pendingSidechainRoutes = new Map<
        string,
        { sourceTrackId: string; targetTrackId: string; targetDeviceId: string }
    >();
    private scheduledNodes: AudioScheduledSourceNode[] = [];
    /**
     * View onto the master metering-processor's SAB, or `null` when no meter tap
     * is wired (before initialize(), after a failed initialize(), after dispose(),
     * in fallback mode, or without AudioWorklet/SharedArrayBuffer). `null` is load
     * bearing: {@link getMasterPeakLevel} returns it verbatim so callers can tell
     * "no measurement" apart from "measured silence". It must never be an inert
     * buffer nothing writes — that reads back as a plausible 0.
     */
    private masterMeterBuffer: Float32Array | null = null;
    private pendingDevicePromises = new Set<Promise<unknown>>();
    private workletReady = false;
    private fallbackMode = false;
    private transportSAB: SharedArrayBuffer | null;
    private transportView: Float64Array | null;
    private transportSeqView: Int32Array | null;
    private runtimeGraphRevision = 0;
    private initPromise: Promise<void> | null = null;
    private initializationCancellation: PromiseWithResolvers<never> | null = null;
    private initializationGeneration = 0;
    private disposed = false;
    private disposalPromise: Promise<void> | null = null;
    private lastInitError: Error | null = null;
    private lastResumeError: Error | null = null;
    private adjustmentRuntime: AdjustmentLayerRuntime;
    private readonly deviceReadinessDiagnostics = createDeviceReadinessDiagnostics();
    private readonly latencyProfile: AudioLatencyProfile | null;
    private readonly latencyHint: 'interactive' | 'playback' | null;

    constructor(providedContext?: AudioContext) {
        // Transport SAB layout: see TRANSPORT_F64 / TRANSPORT_SEQ_I32 above. The
        // seven f64 data fields (slots 0–6) are guarded by a seqlock counter in
        // the Int32 view at TRANSPORT_SEQ_I32 so worklet readers never observe a
        // torn snapshot.
        //
        // Guard the allocation with hasSharedArrayBuffer(): without COOP+COEP the
        // global is absent and `new SharedArrayBuffer(...)` throws. This runs at
        // module load (`export const audioEngine = createAudioEngine()`), so an
        // unguarded throw here aborts the whole module import on a non-isolated
        // page. When SAB is unavailable the views stay null and setTransportInfo
        // no-ops (it already guards on null), so the worklet readers just fall
        // back to their default transport — no torn read, no import crash.
        if (hasSharedArrayBuffer()) {
            this.transportSAB = new SharedArrayBuffer(TRANSPORT_SAB_BYTES);
            this.transportView = new Float64Array(this.transportSAB);
            this.transportSeqView = new Int32Array(this.transportSAB);
        } else {
            this.transportSAB = null;
            this.transportView = null;
            this.transportSeqView = null;
        }

        if (providedContext) {
            this.latencyProfile = null;
            this.latencyHint = null;
        } else {
            this.latencyProfile = readStoredAudioLatencyProfile();
            this.latencyHint = getAudioContextLatencyHint(this.latencyProfile);
        }

        try {
            this.context =
                providedContext ??
                new AudioContext({
                    latencyHint: this.latencyHint ?? getAudioContextLatencyHint(DEFAULT_AUDIO_LATENCY_PROFILE),
                });
            this.masterGainNode = this.context.createGain();
            this.masterGainNode.gain.value = 0.8;

            this.masterAnalyser = this.context.createAnalyser();
            this.masterAnalyser.fftSize = 256;
            this.masterAnalyser.smoothingTimeConstant = 0.8;

            this.masterGainNode.connect(this.masterAnalyser);
            this.masterAnalyser.connect(this.context.destination);
        } catch (error) {
            logger.warn(`Failed to create AudioContext: ${error}`);
            notifyUser(
                'Audio engine failed to initialize — audio playback is disabled. Try reloading the page.',
                'error'
            );
            this.fallbackMode = true;
            this.setupNoopContext();
        }

        this.adjustmentRuntime = createAdjustmentLayerRuntime({
            getContext: () => this.context ?? null,
            getTrackOutputNode: (trackId) => this.trackNodes.get(trackId)?.strip.analyserNode ?? null,
            getTrackDefaultDestination: (trackId) => this.trackNodes.get(trackId)?.getDefaultDestination() ?? null,
            rerouteTrack: (trackId) => this.trackNodes.get(trackId)?.routeOutput(),
        });
    }

    private setupNoopContext() {
        this.context = createNoopAudioContext();
        this.masterGainNode = this.context.createGain();
        this.masterGainNode.gain.value = 0;
        this.masterMeterNode = {
            connect: () => {},
            disconnect: () => {},
            port: { postMessage: () => {} },
        };
        this.masterAnalyser = this.context.createAnalyser();
    }

    private assertActive(): void {
        if (this.disposed) {
            throw new Error('Audio engine has been disposed.');
        }
    }

    private advanceRuntimeGraphRevision(): number {
        this.runtimeGraphRevision++;
        return this.runtimeGraphRevision;
    }

    private hasRuntimeOutputDestination(outputId: string): boolean {
        return outputId === 'master' || outputId === 'hw_out' || this.trackNodes.has(outputId);
    }

    private matchesRuntimeGraphNode(node: TrackNode, expected: RuntimeGraphDeltaNode): boolean {
        const actualDeviceIds = node.strip.deviceNodes.map((device) => device.deviceId);
        return (
            actualDeviceIds.length === expected.devices.length &&
            actualDeviceIds.every((deviceId, index) => deviceId === expected.devices[index]?.id)
        );
    }

    private needsRuntimeGraphReconciliation(
        delta: RuntimeGraphDelta,
        reason: string,
        runtimeRevision = this.runtimeGraphRevision
    ): RuntimeGraphDeltaResult {
        return Object.freeze({
            acceptance: 'accepted' as const,
            application: 'needs-reconcile' as const,
            compensation: 'not-attempted' as const,
            correlation: delta.correlation,
            reason,
            runtimeRevision,
        });
    }

    public initialize(): Promise<void> {
        if (this.disposed) {
            return Promise.reject(new Error('Audio engine has been disposed.'));
        }
        if (this.fallbackMode) {
            return Promise.resolve();
        }
        if (this.initPromise) {
            return this.initPromise;
        }
        // Cache the in-flight/successful load so concurrent callers share it, but
        // do NOT cache a rejection: a failed worklet load (e.g. one addModule
        // 404s) must not poison the engine forever. On rejection we clear the
        // cached promise so the next initialize() retries the load.
        const generation = this.initializationGeneration;
        this.initializationCancellation = Promise.withResolvers<never>();
        this.initPromise = Promise.race([this.loadWorklets(generation), this.initializationCancellation.promise]).catch(
            (error: unknown) => {
                const initError = error instanceof Error ? error : new Error(String(error));
                if (generation === this.initializationGeneration) {
                    this.initPromise = null;
                    this.initializationCancellation = null;
                    this.lastInitError = initError;
                }
                throw initError;
            }
        );
        return this.initPromise;
    }

    private async loadWorklets(generation: number): Promise<void> {
        await Promise.all([
            this.context.audioWorklet.addModule('/audio/worklets/sidechain-compressor-processor.js'),
            this.context.audioWorklet.addModule('/audio/worklets/native-plugin-host-processor.js'),
            this.context.audioWorklet.addModule('/audio/worklets/native-plugin-bridge-processor.js'),
            this.context.audioWorklet.addModule(recordingProcessorUrl),
            this.context.audioWorklet.addModule(meteringProcessorUrl),
            this.context.audioWorklet.addModule(bitcrusherRateProcessorUrl),
        ]);
        if (generation !== this.initializationGeneration) {
            throw new Error('Audio engine was disposed during initialization.');
        }
        this.initializationCancellation = null;
        // The metering-processor module is now registered, so the master meter
        // can be inserted into the master chain. This cannot happen in the
        // constructor — the master nodes are built before any worklet module is
        // loaded (initialize() runs later), exactly like the per-track meter
        // which is built once metering-processor is available.
        this.wireMasterMeter();
        this.workletReady = true;
        this.lastInitError = null;
    }

    /**
     * Insert a SAB-backed metering-processor into the master chain so
     * getMasterPeakLevel reflects real output level. Mirrors the per-track meter
     * wiring in {@link TrackNode}: a 4-byte SharedArrayBuffer holds one peak the
     * worklet writes (Math.max across the block) and the UI read-and-resets.
     *
     * Chain before: masterGainNode → masterAnalyser → destination.
     * Chain after:  masterGainNode → masterMeterNode → masterAnalyser → destination.
     * The metering-processor passes audio straight through, so the audible signal
     * is unchanged — it only taps the peak. Idempotent: a second initialize()
     * (e.g. after dispose()) replaces the existing meter node rather than
     * stacking a second tap.
     */
    private wireMasterMeter(): void {
        // `this.fallbackMode` is deliberately *not* tested here. initialize()
        // returns early on fallback, before loadWorklets() — the sole caller of
        // this method — so the disjunct could only ever evaluate false, and a
        // branch with one reachable verdict is not a guard. Fallback mode reaches
        // the same verdict by construction instead: setupNoopContext never assigns
        // masterMeterBuffer, so it stays null and getMasterPeakLevel reports
        // unavailable. That path is guarded separately (fallbackMode spec, M9).
        if (typeof AudioWorkletNode === 'undefined' || !hasSharedArrayBuffer()) {
            // No worklet support or no SAB: there is no tap to read. Clear the
            // buffer so getMasterPeakLevel reports `null` ("unavailable") rather
            // than a fabricated 0 — which the status bar renders as "-∞ dB",
            // indistinguishable from a silent mix while audio is playing
            // (ADR 0012: a downgrade must never be silent).
            this.masterMeterBuffer = null;
            logger.warn(
                '[audio-engine] master meter not wired ' +
                    `(AudioWorkletNode=${String(typeof AudioWorkletNode !== 'undefined')}, ` +
                    `SharedArrayBuffer=${String(hasSharedArrayBuffer())}) — ` +
                    'the master level readout reports unavailable until it is.'
            );
            return;
        }
        // Tear down a previously-wired meter node so a re-initialize does not
        // leave a stale tap summing into the analyser.
        const previous = this.masterMeterNode;
        if (previous && typeof AudioWorkletNode !== 'undefined' && previous instanceof AudioWorkletNode) {
            try {
                previous.disconnect();
            } catch {
                // already disconnected
            }
        }

        const meterSab = new SharedArrayBuffer(4);
        const meterNode = new AudioWorkletNode(this.context, 'metering-processor');
        meterNode.port.postMessage({ type: 'init', sab: meterSab });
        this.masterMeterNode = meterNode;
        this.masterMeterBuffer = new Float32Array(meterSab);

        // Re-route the master chain through the meter node.
        this.masterGainNode.disconnect();
        this.masterGainNode.connect(meterNode);
        meterNode.connect(this.masterAnalyser);
    }

    public getHealth(): AudioEngineHealth {
        return {
            workletReady: this.workletReady,
            lastInitError: this.lastInitError,
            lastResumeError: this.lastResumeError,
            // Read straight out of the shared counters (audit RT-10) — no message
            // round-trip, no polling of the audio thread. See dropoutCounter.ts
            // for exactly which dropouts this does and does not capture.
            dropouts: dropoutCounters.read(),
        };
    }

    public getDeviceReadinessDiagnostics() {
        return this.deviceReadinessDiagnostics.snapshot();
    }

    public isAudioAvailable(): boolean {
        return !this.fallbackMode;
    }

    public getDiagnostics(): AudioEngineDiagnostics {
        const engineState = this.getState();
        const context = {
            state: engineState.state,
            sampleRate: engineState.sampleRate,
            baseLatency: engineState.baseLatency,
            outputLatency: engineState.outputLatency,
            latencyProfile: this.latencyProfile,
            latencyHint: this.latencyHint,
        };
        if (this.fallbackMode) {
            return {
                context,
                playback: null,
                graph: {
                    trackStrips: 0,
                    busStrips: 0,
                    sends: 0,
                    sidechains: 0,
                    deviceInstances: 0,
                    pendingDeviceInstances: 0,
                    failedDeviceInstances: 0,
                    deviceInstancesByType: {},
                    deviceAudioNodes: 0,
                    graphSlotResourcesByLoadState: createEmptyGraphSlotResourcesByLoadState(),
                    deviceAudioWorkletProcessors: 0,
                    deviceAudioWorkletProcessorsByType: {},
                    stripMeterWorklets: 0,
                    masterMeterWorklets: 0,
                    graphAudioWorkletProcessors: 0,
                    workerInstances: 0,
                    workerInstancesByType: {},
                    adjustmentLayerBuses: 0,
                    adjustmentLayerBusesByEffectType: {},
                    adjustmentLayerAudioNodes: 0,
                    adjustmentLayerAudioWorkletProcessors: 0,
                },
                runtime: {
                    trackedAudioScheduledSources: 0,
                    processorLifecycle: { unmanaged: 0, continue: 0, continueIfNotQuiet: 0, tail: 0, sleep: 0 },
                },
            };
        }
        const deviceInstancesByType = new Map<string, number>();
        const deviceAudioWorkletProcessorsByType = new Map<string, number>();
        const workerInstancesByType = new Map<string, number>();
        const graphSlotResourcesByLoadState = createEmptyGraphSlotResourcesByLoadState();
        let deviceInstances = 0;
        let pendingDeviceInstances = 0;
        let failedDeviceInstances = 0;
        let deviceAudioNodes = 0;
        let deviceAudioWorkletProcessors = 0;
        let workerInstances = 0;
        let stripMeterWorklets = 0;
        const processorLifecycle: { unmanaged: number } & Record<AudioProcessorLifecycleState, number> = {
            unmanaged: 0,
            continue: 0,
            continueIfNotQuiet: 0,
            tail: 0,
            sleep: 0,
        };

        for (const trackNode of this.trackNodes.values()) {
            if (trackNode.strip.meterNode) {
                stripMeterWorklets++;
            }
            for (const device of trackNode.strip.deviceNodes) {
                const resources = countDeviceRuntimeResources(device);
                deviceAudioNodes += resources.audioNodes;
                deviceAudioWorkletProcessors += resources.audioWorkletProcessors;
                const lifecycleState = device.processorLifecycle?.() ?? null;
                if (lifecycleState && resources.audioWorkletProcessors > 0) {
                    processorLifecycle[lifecycleState]++;
                    processorLifecycle.unmanaged += resources.audioWorkletProcessors - 1;
                } else {
                    processorLifecycle.unmanaged += resources.audioWorkletProcessors;
                }
                addCountByType(deviceAudioWorkletProcessorsByType, device.type, resources.audioWorkletProcessors);
                workerInstances += resources.workers;
                addCountByType(workerInstancesByType, device.type, resources.workers);
                const loadState = trackNode.getDeviceLoadState(device.deviceId);
                addDeviceResources(graphSlotResourcesByLoadState[loadState], resources);
                if (loadState === 'pending') {
                    pendingDeviceInstances++;
                    continue;
                }
                if (loadState === 'failed') {
                    failedDeviceInstances++;
                    continue;
                }
                deviceInstances++;
                addCountByType(deviceInstancesByType, device.type, 1);
            }
        }

        const masterMeterWorklets = this.masterMeterNode instanceof AudioWorkletNode ? 1 : 0;
        const adjustmentDiagnostics = this.adjustmentRuntime.getDiagnostics();
        processorLifecycle.unmanaged += adjustmentDiagnostics.audioWorkletProcessors;
        const graphAudioWorkletProcessors =
            deviceAudioWorkletProcessors +
            adjustmentDiagnostics.audioWorkletProcessors +
            stripMeterWorklets +
            masterMeterWorklets;
        const playback = readPlaybackStats(this.context);

        return {
            context,
            playback,
            graph: {
                // A bus owns a backing TrackNode; keep the public counters disjoint.
                trackStrips: this.trackNodes.size - this.busNodes.size,
                busStrips: this.busNodes.size,
                sends: this.sendNodes.size,
                sidechains: this.sidechainConnections.size,
                deviceInstances,
                pendingDeviceInstances,
                failedDeviceInstances,
                deviceInstancesByType: toSortedCountRecord(deviceInstancesByType),
                deviceAudioNodes,
                graphSlotResourcesByLoadState,
                deviceAudioWorkletProcessors,
                deviceAudioWorkletProcessorsByType: toSortedCountRecord(deviceAudioWorkletProcessorsByType),
                stripMeterWorklets,
                masterMeterWorklets,
                graphAudioWorkletProcessors,
                workerInstances,
                workerInstancesByType: toSortedCountRecord(workerInstancesByType),
                adjustmentLayerBuses: adjustmentDiagnostics.buses,
                adjustmentLayerBusesByEffectType: adjustmentDiagnostics.busesByEffectType,
                adjustmentLayerAudioNodes: adjustmentDiagnostics.audioNodes,
                adjustmentLayerAudioWorkletProcessors: adjustmentDiagnostics.audioWorkletProcessors,
            },
            runtime: {
                trackedAudioScheduledSources: this.scheduledNodes.length,
                processorLifecycle,
            },
        };
    }

    public resetPlaybackLatencyStats(): void {
        if (this.fallbackMode) {
            return;
        }
        getChromePlaybackStats(this.context).resetLatency();
    }

    public async resume(): Promise<void> {
        if (this.fallbackMode) {
            return;
        }
        try {
            if (this.context.state === 'suspended') {
                await this.context.resume();
            }
            this.lastResumeError = null;
        } catch (error) {
            // Surface the failure instead of swallowing it: a gesture handler can
            // read getHealth().lastResumeError to re-arm / warn the user, and the
            // rejection now propagates so a `void resume()` caller no longer
            // silently leaves the context suspended (no audio).
            this.lastResumeError = error instanceof Error ? error : new Error(String(error));
            logger.warn(`AudioContext resume failed: ${error}`);
            throw this.lastResumeError;
        }
    }

    public async suspend(): Promise<void> {
        if (this.fallbackMode) {
            return;
        }
        try {
            if (this.context.state === 'running') {
                await this.context.suspend();
            }
        } catch (error) {
            logger.warn(`AudioContext suspend failed: ${error}`);
        }
    }

    public setMasterGain(value: number): void {
        if (this.fallbackMode) {
            return;
        }
        this.masterGainNode.gain.setTargetAtTime(Math.max(0, Math.min(1, value)), this.context.currentTime, 0.01);
    }

    public getMasterGain(): number {
        if (this.fallbackMode) {
            return 0;
        }
        return this.masterGainNode.gain.value;
    }

    public getState(): AudioEngineState {
        if (this.fallbackMode) {
            return {
                isReady: false,
                sampleRate: 44100,
                state: 'closed',
                masterGain: 0,
                currentTime: 0,
                baseLatency: 0,
                outputLatency: 0,
            };
        }
        return {
            isReady: this.context.state === 'running' || this.workletReady,
            sampleRate: this.context.sampleRate,
            state: this.context.state,
            masterGain: this.masterGainNode.gain.value,
            currentTime: this.context.currentTime,
            baseLatency: this.context.baseLatency ?? 0,
            outputLatency: this.context.outputLatency ?? 0,
        };
    }

    public getRuntimeGraphRevision(): number {
        return this.runtimeGraphRevision;
    }

    /**
     * The sole consumer for compiled output-topology deltas. It runs only on the
     * main/control thread, after the compiler has bounded and frozen its input;
     * no worklet callback receives, parses, or allocates for this command.
     */
    public applyRuntimeGraphDelta(input: unknown): RuntimeGraphDeltaResult {
        const compilation = compileRuntimeGraphDelta(input);
        if (compilation.status === 'invalid') {
            return Object.freeze({
                acceptance: 'rejected' as const,
                application: 'not-applied' as const,
                reason: compilation.reason,
            });
        }

        const { delta } = compilation;
        if (delta.correlation.appRevision !== this.runtimeGraphRevision) {
            return Object.freeze({
                acceptance: 'rejected' as const,
                application: 'not-applied' as const,
                reason: 'Runtime graph delta is stale for the live engine revision',
            });
        }

        const edge = delta.edges[0];
        const sourcePlan = delta.nodes[0];
        if (!edge || !sourcePlan) {
            return Object.freeze({
                acceptance: 'rejected' as const,
                application: 'not-applied' as const,
                reason: 'Compiled runtime graph delta has no output source',
            });
        }
        const source = this.trackNodes.get(edge.sourceId);
        if (!source || !this.matchesRuntimeGraphNode(source, sourcePlan)) {
            return this.needsRuntimeGraphReconciliation(
                delta,
                'Live source strip does not match the compiled graph delta'
            );
        }
        if (!this.hasRuntimeOutputDestination(edge.targetId)) {
            return this.needsRuntimeGraphReconciliation(
                delta,
                'Live destination strip does not match the compiled graph delta'
            );
        }
        const targetPlan = delta.nodes[1];
        if (targetPlan) {
            const target = this.trackNodes.get(targetPlan.id);
            if (!target || !this.matchesRuntimeGraphNode(target, targetPlan)) {
                return this.needsRuntimeGraphReconciliation(
                    delta,
                    'Live destination strip does not match the compiled graph delta'
                );
            }
        }

        try {
            source.setOutput(edge.targetId);
        } catch (error) {
            // A host-side node operation may have partially taken effect. Do not
            // claim a CRDT rollback restored it: advance the generation and force
            // an owner-led reconcile instead.
            return this.needsRuntimeGraphReconciliation(
                delta,
                `Live output application threw: ${String(error)}`,
                this.advanceRuntimeGraphRevision()
            );
        }
        return Object.freeze({
            acceptance: 'accepted' as const,
            application: 'applied' as const,
            correlation: delta.correlation,
            runtimeRevision: this.advanceRuntimeGraphRevision(),
        });
    }

    private reconnectRoutingForTrack(trackId: string): void {
        const strip = this.trackNodes.get(trackId)?.strip;
        if (!strip) {
            return;
        }
        for (const send of this.sendNodes.values()) {
            if (send.sourceTrackId !== trackId) {
                continue;
            }
            const sourceNode = send.preFader ? strip.preFaderTap : strip.analyserNode;
            try {
                send.sourceNode.disconnect(send.gainNode);
            } catch {
                // A wider rebuild may already have removed the prior source edge.
            }
            sourceNode.connect(send.gainNode);
            send.sourceNode = sourceNode;
        }
        for (const connection of this.sidechainConnections.values()) {
            if (connection.sourceTrackId !== trackId) {
                continue;
            }
            // The tap stays post-fader (`analyserNode`); the key alignment line
            // sits between it and the route gain, so a rebuild re-attaches the
            // tap to the delay rather than straight to the gain.
            const sourceNode = strip.analyserNode;
            try {
                connection.sourceNode.disconnect(connection.keyDelayNode);
            } catch {
                // A wider rebuild may already have removed the prior source edge.
            }
            sourceNode.connect(connection.keyDelayNode);
            connection.sourceNode = sourceNode;
        }
    }

    private detachToasterPadRoute(trackId: string, forgetRoute: boolean): void {
        const route = this.toasterPadRoutes.get(trackId);
        if (!route) {
            return;
        }
        if (route.destinationNode) {
            try {
                route.controls?.disconnectPadOutput?.(route.padIndex, route.destinationNode);
            } finally {
                route.controls?.setPadDryRouted(route.padIndex, false);
            }
        }
        route.destinationNode = null;
        route.controls = null;
        if (forgetRoute) {
            this.toasterPadRoutes.delete(trackId);
        }
    }

    private reconcileToasterParent(toasterParentTrackId: string): void {
        const device = this.trackNodes
            .get(toasterParentTrackId)
            ?.strip.deviceNodes.find((candidate) => candidate.toasterControls?.connectPadOutput);
        const controls = device?.toasterControls;
        if (!controls?.connectPadOutput) {
            return;
        }
        for (const [trackId, route] of this.toasterPadRoutes) {
            if (route.toasterParentTrackId !== toasterParentTrackId || route.controls === controls) {
                continue;
            }
            if (route.destinationNode) {
                this.detachToasterPadRoute(trackId, false);
            }
            const destinationNode = this.trackNodes.get(trackId)?.strip.gainNode;
            if (!destinationNode) {
                continue;
            }
            controls.connectPadOutput(route.padIndex, destinationNode);
            controls.setPadDryRouted(route.padIndex, true);
            route.destinationNode = destinationNode;
            route.controls = controls;
        }
    }

    private handleDeviceRemoved(trackId: string, device: BuiltinDeviceNode): void {
        if (device.type !== 'toaster') {
            return;
        }
        for (const [sourceTrackId, route] of this.toasterPadRoutes) {
            if (route.toasterParentTrackId !== trackId) {
                continue;
            }
            if (route.controls && route.controls !== device.toasterControls) {
                continue;
            }
            this.detachToasterPadRoute(sourceTrackId, false);
        }
        this.reconcileToasterParent(trackId);
    }

    public ensureTrackStrip(trackId: string): TrackChannelStrip {
        this.assertActive();
        let node = this.trackNodes.get(trackId);
        if (!node) {
            if (this.fallbackMode) {
                const sG = this.context.createGain();
                node = new TrackNode(trackId, {
                    context: this.context,
                    masterGainNode: sG,
                    getBusGainNode: () => undefined,
                    getTrackGainNode: () => undefined,
                    getSendsForTrack: () => [],
                    pendingDevicePromises: new Set(),
                    readinessDiagnostics: this.deviceReadinessDiagnostics,
                    getAdjustmentBusForTrack: (id) => this.adjustmentRuntime.getBusInputForTrack(id),
                });
            } else {
                node = new TrackNode(trackId, {
                    context: this.context,
                    masterGainNode: this.masterGainNode,
                    getBusGainNode: (id) => this.busNodes.get(id)?.strip.gainNode,
                    getTrackGainNode: (id) => this.trackNodes.get(id)?.strip.gainNode,
                    getSendsForTrack: (tId) =>
                        Array.from(this.sendNodes.values()).filter((state) => state.sourceTrackId === tId),
                    pendingDevicePromises: this.pendingDevicePromises,
                    readinessDiagnostics: this.deviceReadinessDiagnostics,
                    transportSAB: this.transportSAB ?? undefined,
                    getAdjustmentBusForTrack: (id) => this.adjustmentRuntime.getBusInputForTrack(id),
                    reconnectRoutingForTrack: (id) => this.reconnectRoutingForTrack(id),
                    onDeviceLoaded: (id) => this.reconcileToasterParent(id),
                    onDeviceRemoved: (id, device) => this.handleDeviceRemoved(id, device),
                });
            }
            this.trackNodes.set(trackId, node);
        }
        return node.strip;
    }

    public removeTrackStrip(trackId: string): void {
        const node = this.trackNodes.get(trackId);
        // TrackNode.dispose() clears deviceNodes. Capture the ids first so all
        // live and pending sidechains targeting this strip can be identified.
        const removedDeviceIds = new Set(node?.strip.deviceNodes.map((device) => device.deviceId) ?? []);

        // Fallback-mode wiring can queue routes without ever materializing a
        // source or target strip. Purge endpoint ownership before the node guard
        // so removing either absent endpoint cannot leave a replayable route.
        for (const [key, route] of this.pendingSidechainRoutes) {
            const belongsToRemovedStrip =
                route.sourceTrackId === trackId ||
                route.targetTrackId === trackId ||
                removedDeviceIds.has(route.targetDeviceId);
            if (belongsToRemovedStrip) {
                this.pendingSidechainRoutes.delete(key);
            }
        }
        this.detachToasterPadRoute(trackId, true);
        for (const [sourceTrackId, route] of this.toasterPadRoutes) {
            if (route.toasterParentTrackId === trackId) {
                this.detachToasterPadRoute(sourceTrackId, true);
            }
        }
        if (!node) {
            return;
        }

        // Sweep dependent routing keyed on this track as the source, mirroring
        // removeBusStrip's busId sweep. Without this, the send/sidechain GainNodes
        // for the removed track survive in the maps — still wired into their bus /
        // target device, leaking nodes and (for sends) re-summing a ghost tap.
        for (const send of Array.from(this.sendNodes.values())) {
            if (send.sourceTrackId === trackId) {
                this.removeSend(send.sourceTrackId, send.busId);
            }
        }
        for (const [key, connection] of this.sidechainConnections) {
            if (connection.sourceTrackId === trackId || removedDeviceIds.has(connection.targetDeviceId)) {
                this.removeLiveSidechainConnection(key);
            }
        }
        // A track-to-track output is a live edge into the target strip. Preserve
        // the remaining source strips and make the fallback explicit: `hw_out`
        // routes through TrackNode's masterGainNode destination.
        for (const [sourceTrackId, sourceNode] of this.trackNodes) {
            if (sourceTrackId !== trackId && sourceNode.strip.outputId === trackId) {
                sourceNode.setOutput('hw_out');
            }
        }
        node.dispose();
        this.trackNodes.delete(trackId);
    }

    public getTrackStrip(trackId: string): TrackChannelStrip | undefined {
        return this.trackNodes.get(trackId)?.strip;
    }

    public findToasterControls(deviceId: string): ToasterDeviceControls | undefined {
        // Owns the strip/device-node traversal so foreign modules (Toaster) do not
        // reach into strip internals to reach a loaded device's control surface.
        for (const [, trackNode] of this.trackNodes) {
            const deviceNode = trackNode.strip.deviceNodes.find((dn) => dn.deviceId === deviceId);
            if (deviceNode?.toasterControls) {
                return deviceNode.toasterControls;
            }
        }
        return undefined;
    }

    public setTrackGain(trackId: string, gain: number): void {
        this.trackNodes.get(trackId)?.setGain(gain);
    }

    public setTrackPan(trackId: string, pan: number): void {
        this.trackNodes.get(trackId)?.setPan(pan);
    }

    public scheduleTrackGain(trackId: string, gain: number, time: number): void {
        this.trackNodes.get(trackId)?.scheduleGainAutomation(gain, time);
    }

    public scheduleTrackPan(trackId: string, pan: number, time: number): void {
        this.trackNodes.get(trackId)?.schedulePanAutomation(pan, time);
    }

    public cancelTrackAutomationRamps(): void {
        if (this.fallbackMode) {
            return;
        }
        for (const trackNode of this.trackNodes.values()) {
            trackNode.cancelAutomationRamps();
        }
    }

    public setTrackMute(trackId: string, muted: boolean): void {
        this.ensureTrackStrip(trackId);
        this.trackNodes.get(trackId)?.setMute(muted);
    }

    public setTrackSoloGate(trackId: string, gated: boolean): void {
        this.ensureTrackStrip(trackId);
        this.trackNodes.get(trackId)?.setSoloGate(gated);
    }

    public getTrackPeakLevel(trackId: string): number {
        return this.trackNodes.get(trackId)?.getPeakLevel() ?? 0;
    }

    /**
     * The master output peak in linear amplitude, or `null` when no meter tap is
     * wired and the engine therefore has no measurement to report.
     *
     * `null` and `0` are different claims and callers must render them
     * differently: `0` says the worklet measured this block and it was silent,
     * `null` says nobody measured anything. Collapsing the two is what let a
     * status bar show "-∞ dB" over a mix that was audibly playing.
     */
    public getMasterPeakLevel(): number | null {
        if (!this.masterMeterBuffer) {
            return null;
        }
        // Read-and-reset of a single f32, deliberately without Atomics (audit
        // RT-9) — same scalar-meter exception as TrackNode.getPeakLevel.
        // Rationale in the module header of services/meteringProcessor.ts.
        const peak = this.masterMeterBuffer[0]!;
        this.masterMeterBuffer[0] = 0;
        return peak;
    }

    public ensureBusStrip(busId: string): BusStrip {
        let node = this.busNodes.get(busId);
        if (!node) {
            this.ensureTrackStrip(busId);
            const trackNode = this.trackNodes.get(busId);
            if (!trackNode) {
                throw new Error(`Failed to create track strip for bus ${busId}`);
            }
            node = new BusNode(busId, trackNode);
            this.busNodes.set(busId, node);
        }
        return node.strip;
    }

    public removeBusStrip(busId: string): void {
        const node = this.busNodes.get(busId);
        if (!node) {
            return;
        }
        for (const send of Array.from(this.sendNodes.values())) {
            if (send.busId === busId) {
                this.removeSend(send.sourceTrackId, send.busId);
            }
        }
        this.removeTrackStrip(busId);
        node.dispose();
        this.busNodes.delete(busId);
    }

    public setBusGain(busId: string, gain: number): void {
        this.busNodes.get(busId)?.setGain(gain);
    }

    public getBusPeakLevel(busId: string): number {
        return this.busNodes.get(busId)?.getPeakLevel() ?? 0;
    }

    public addDeviceToStrip(
        trackId: string,
        deviceId: string,
        deviceType: string,
        externalInstanceId?: string,
        precedingDeviceIds?: readonly string[]
    ): void {
        if (this.fallbackMode) {
            return;
        }
        this.ensureTrackStrip(trackId);
        this.trackNodes.get(trackId)?.addDevice(deviceId, deviceType, externalInstanceId, precedingDeviceIds);
    }

    public removeDeviceFromStrip(trackId: string, deviceId: string): void {
        if (this.fallbackMode) {
            return;
        }
        this.trackNodes.get(trackId)?.removeDevice(deviceId);
    }

    public updateDeviceParam(trackId: string, deviceId: string, paramId: string, value: number): void {
        if (this.fallbackMode) {
            return;
        }
        this.trackNodes.get(trackId)?.updateParam(deviceId, paramId, value);
    }

    public updateDevicePatch(trackId: string, deviceId: string, patch: Record<string, unknown>): void {
        if (this.fallbackMode) {
            return;
        }
        this.trackNodes.get(trackId)?.updatePatch(deviceId, patch);
    }

    public scheduleDeviceParam(trackId: string, deviceId: string, paramId: string, value: number, time: number): void {
        if (this.fallbackMode) {
            return;
        }
        this.trackNodes.get(trackId)?.scheduleParam(deviceId, paramId, value, time);
    }

    public scheduleDeviceKeyOn(
        trackId: string,
        deviceId: string,
        pitch: number,
        velocity: number,
        time?: number
    ): void {
        if (this.fallbackMode) {
            return;
        }
        this.trackNodes.get(trackId)?.scheduleDeviceKeyOn(deviceId, pitch, velocity, time);
    }

    public scheduleDeviceKeyOff(
        trackId: string,
        deviceId: string,
        pitch: number,
        velocity: number,
        time?: number
    ): void {
        if (this.fallbackMode) {
            return;
        }
        this.trackNodes.get(trackId)?.scheduleDeviceKeyOff(deviceId, pitch, velocity, time);
    }

    public updateDeviceBypass(trackId: string, deviceId: string, bypassed: boolean): void {
        if (this.fallbackMode) {
            return;
        }
        this.trackNodes.get(trackId)?.updateBypass(deviceId, bypassed);
    }

    public addMidiFxToStrip(trackId: string, fxId: string, fxType: 'arp' | 'velocity' | 'probability'): void {
        if (this.fallbackMode) {
            return;
        }
        this.trackNodes.get(trackId)?.addMidiFx(fxId, fxType);
    }

    public removeMidiFxFromStrip(trackId: string, fxId: string): void {
        if (this.fallbackMode) {
            return;
        }
        this.trackNodes.get(trackId)?.removeMidiFx(fxId);
    }

    public updateMidiFxParam(trackId: string, fxId: string, paramId: string, value: number): void {
        if (this.fallbackMode) {
            return;
        }
        this.trackNodes.get(trackId)?.updateMidiFxParam(fxId, paramId, value);
    }

    public updateMidiFxBypass(trackId: string, fxId: string, bypassed: boolean): void {
        if (this.fallbackMode) {
            return;
        }
        this.trackNodes.get(trackId)?.updateMidiFxBypass(fxId, bypassed);
    }

    public syncKneadState(trackId: string, clips: Record<string, unknown>): void {
        const trackNode = this.trackNodes.get(trackId);
        if (trackNode) {
            for (const dn of trackNode.strip.deviceNodes) {
                if (dn.kneadControls) {
                    dn.kneadControls.updateState(clips);
                }
            }
        }
    }

    public registerTuningTable(frequencies: number[]): void {
        if (this.fallbackMode) {
            return;
        }
        for (const trackNode of this.trackNodes.values()) {
            trackNode.registerTuningTable(frequencies);
        }
    }

    public setTransportInfo(
        beat: number,
        tempo: number,
        isPlaying: boolean,
        loopStart = 0,
        loopEnd = 0,
        isLooping = false
    ): void {
        const value = this.transportView;
        const seq = this.transportSeqView;
        if (!value || !seq) {
            // Released by dispose(); nothing to write into.
            return;
        }
        // Seqlock write: bump the counter to an odd value (write in progress),
        // publish the seven fields, then bump it to the next even value (write
        // complete). A worklet reader that samples an odd or changed counter
        // around its read retries, so it never sees a snapshot torn across the
        // seven plain f64 writes. The trailing Atomics.store also publishes the
        // field writes to other agents (release semantics).
        const odd = Atomics.load(seq, TRANSPORT_SEQ_I32) + 1;
        Atomics.store(seq, TRANSPORT_SEQ_I32, odd);
        value[TRANSPORT_F64.beat] = beat;
        value[TRANSPORT_F64.tempo] = tempo;
        value[TRANSPORT_F64.sampleRate] = this.context.sampleRate;
        value[TRANSPORT_F64.loopStart] = loopStart;
        value[TRANSPORT_F64.loopEnd] = loopEnd;
        value[TRANSPORT_F64.isPlaying] = isPlaying ? 1 : 0;
        value[TRANSPORT_F64.isLooping] = isLooping ? 1 : 0;
        Atomics.store(seq, TRANSPORT_SEQ_I32, odd + 1);
    }

    public setSend(sourceTrackId: string, busId: string, level: number, preFader = false): void {
        if (this.fallbackMode) {
            return;
        }
        const trackNode = this.trackNodes.get(sourceTrackId);
        if (!trackNode) {
            return;
        }
        const busStrip = this.ensureBusStrip(busId);
        const key = `${sourceTrackId}→${busId}`;

        const clampedLevel = Math.max(0, Math.min(1, level));
        const existing = this.sendNodes.get(key);
        if (existing) {
            if (existing.preFader !== preFader) {
                this.crossfadeSendTap(existing, busStrip, preFader, clampedLevel);
            } else {
                existing.gainNode.gain.setTargetAtTime(clampedLevel, this.context.currentTime, 0.01);
            }
            return;
        }

        const sendGain = this.context.createGain();
        sendGain.gain.value = clampedLevel;
        const tap = preFader ? trackNode.strip.preFaderTap : trackNode.strip.analyserNode;
        tap.connect(sendGain);
        sendGain.connect(busStrip.gainNode);
        this.sendNodes.set(key, { sourceTrackId, busId, gainNode: sendGain, sourceNode: tap, preFader });
    }

    public scheduleSendAutomation(sourceTrackId: string, busId: string, level: number, time: number): void {
        if (this.fallbackMode) {
            return;
        }
        this.trackNodes.get(sourceTrackId)?.scheduleSendAutomation(busId, level, time);
    }

    /**
     * Switch a live send between the pre- and post-fader tap without a gap of
     * silence on the bus. A hard `disconnect()` then `connect()` left the bus with
     * no input for one render quantum (~2.7ms at 48k) — audible on a pumping bus.
     * Instead we build a fresh gain on the new tap and equal-time-crossfade: the
     * new gain ramps 0→level while the old gain ramps level→0 over the same
     * window, so the bus is continuously fed. After the ramp the old node is torn
     * down. The teardown is deferred on the control thread (`setTimeout`), never
     * on the audio thread, so the RT graph is untouched by the cleanup.
     */
    private crossfadeSendTap(existing: SendNode, busStrip: BusStrip, preFader: boolean, clampedLevel: number): void {
        const now = this.context.currentTime;
        const end = now + SEND_TAP_CROSSFADE_SECONDS;

        const sourceStrip = this.trackNodes.get(existing.sourceTrackId)?.strip;
        if (!sourceStrip) {
            return;
        }
        const newTap = preFader ? sourceStrip.preFaderTap : sourceStrip.analyserNode;
        const newGain = this.context.createGain();
        newGain.gain.setValueAtTime(0, now);
        newGain.gain.linearRampToValueAtTime(clampedLevel, end);
        newTap.connect(newGain);
        newGain.connect(busStrip.gainNode);

        // Ramp the outgoing gain to silence over the same window. Pin its current
        // value first so the ramp starts from where it is, not from a stale
        // scheduled value.
        const oldGain = existing.gainNode;
        const oldSource = existing.sourceNode;
        oldGain.gain.cancelScheduledValues(now);
        oldGain.gain.setValueAtTime(oldGain.gain.value, now);
        oldGain.gain.linearRampToValueAtTime(0, end);

        // Promote the new node to the live send and tear the old one down after
        // the crossfade completes (plus a small margin) on the control thread.
        existing.gainNode = newGain;
        existing.sourceNode = newTap;
        existing.preFader = preFader;
        const teardownMs = (SEND_TAP_CROSSFADE_SECONDS + SEND_TAP_CROSSFADE_TEARDOWN_MARGIN_SECONDS) * 1000;
        setTimeout(() => {
            try {
                oldSource.disconnect(oldGain);
            } catch {
                // The old source edge may already be gone after wider teardown.
            }
            try {
                oldGain.disconnect();
            } catch {
                // removeSend or resetGraph may already have torn down the gain.
            }
        }, teardownMs);
    }

    public removeSend(sourceTrackId: string, busId: string): void {
        const key = `${sourceTrackId}→${busId}`;
        const send = this.sendNodes.get(key);
        if (send) {
            try {
                send.sourceNode.disconnect(send.gainNode);
            } catch {
                // The source edge may already be gone after a graph rebuild.
            }
            send.gainNode.disconnect();
            this.sendNodes.delete(key);
        }
    }

    public setTrackOutput(
        trackId: string,
        outputId: string,
        padBinding?: { toasterParentTrackId: string; padIndex: number }
    ): void {
        const trackNode = this.trackNodes.get(trackId);
        if (!trackNode) {
            return;
        }
        if (!this.hasRuntimeOutputDestination(outputId)) {
            logger.warn(`[AudioEngine] Rejected output route to absent live destination: ${trackId} -> ${outputId}`);
            return;
        }
        trackNode.setOutput(outputId);
        this.advanceRuntimeGraphRevision();
        if (
            !padBinding ||
            !Number.isInteger(padBinding.padIndex) ||
            padBinding.padIndex < 0 ||
            padBinding.padIndex >= 16
        ) {
            this.detachToasterPadRoute(trackId, true);
            return;
        }
        const existing = this.toasterPadRoutes.get(trackId);
        const changedOwner =
            existing &&
            (existing.toasterParentTrackId !== padBinding.toasterParentTrackId ||
                existing.padIndex !== padBinding.padIndex);
        if (changedOwner) {
            this.detachToasterPadRoute(trackId, true);
        }
        if (!this.toasterPadRoutes.has(trackId)) {
            this.toasterPadRoutes.set(trackId, { ...padBinding, destinationNode: null, controls: null });
        }
        this.reconcileToasterParent(padBinding.toasterParentTrackId);
    }

    public async waitForDevices(timeoutMs = 10000): Promise<void> {
        const deadline = Date.now() + timeoutMs;
        while (this.pendingDevicePromises.size > 0) {
            const remainingMs = Math.max(0, deadline - Date.now());
            let timeoutId: ReturnType<typeof setTimeout> | undefined;
            const timedOut = await Promise.race([
                Promise.allSettled(this.pendingDevicePromises).then(() => false),
                new Promise<true>((resolve) => {
                    timeoutId = setTimeout(() => resolve(true), remainingMs);
                }),
            ]);
            if (timeoutId !== undefined) {
                clearTimeout(timeoutId);
            }
            if (timedOut) {
                logger.warn(`[AudioEngine] Device loading timed out (${this.pendingDevicePromises.size} pending)`);
                for (const trackNode of this.trackNodes.values()) {
                    trackNode.timeoutPendingDeviceLoads();
                }
                this.pendingDevicePromises.clear();
                return;
            }
        }
    }

    public wireSidechainRoute(sourceTrackId: string, targetTrackId: string, targetDeviceId: string): void {
        const key = `${sourceTrackId}→${targetDeviceId}`;
        if (this.fallbackMode) {
            // No live AudioContext to wire into. Queue the route instead of
            // dropping it, so the next time wiring runs outside fallback mode the
            // route is replayed rather than lost (the store keeps the route, so
            // silently no-op'ing here would diverge the live graph with no
            // recovery path).
            this.pendingSidechainRoutes.set(key, { sourceTrackId, targetTrackId, targetDeviceId });
            return;
        }
        // Recovery: drain any routes queued while the engine was in fallback mode
        // before honoring this request, so a route requested before the engine
        // was usable is now wired up.
        this.replayPendingSidechainRoutes();
        this.applySidechainRoute(sourceTrackId, targetTrackId, targetDeviceId);
    }

    /**
     * Re-attempt every sidechain route queued during fallback mode. Routes that
     * still cannot be wired (e.g. the target strip/device is not present yet) are
     * dropped from the queue by applySidechainRoute's own guards — they are no
     * longer recoverable through this path and the caller owns re-requesting.
     */
    private replayPendingSidechainRoutes(): void {
        if (this.pendingSidechainRoutes.size === 0) {
            return;
        }
        const queued = Array.from(this.pendingSidechainRoutes.values());
        this.pendingSidechainRoutes.clear();
        for (const route of queued) {
            this.applySidechainRoute(route.sourceTrackId, route.targetTrackId, route.targetDeviceId);
        }
    }

    private applySidechainRoute(sourceTrackId: string, targetTrackId: string, targetDeviceId: string): void {
        const sourceStrip = this.trackNodes.get(sourceTrackId)?.strip;
        const targetStrip = this.trackNodes.get(targetTrackId)?.strip;
        if (!sourceStrip || !targetStrip) {
            return;
        }

        const deviceNode = targetStrip.deviceNodes.find((data) => data.deviceId === targetDeviceId);
        if (!deviceNode || deviceNode.type !== 'builtin-sidechain-compressor') {
            return;
        }

        const key = `${sourceTrackId}→${targetDeviceId}`;
        if (this.sidechainConnections.has(key)) {
            return;
        }

        const scGain = this.context.createGain();
        scGain.gain.value = 1;
        // FX-5 — the key is tapped post-fader, so it reaches the detector on the
        // source track's clock, not the detector's. The alignment line goes
        // between the tap and the route gain: after the metering/sends tap (which
        // must keep reading the un-delayed signal) and before the detector input.
        // It starts at zero and is filled in by refreshSidechainAlignment, which
        // owns every write to it so there is exactly one place the value lands.
        const keyDelayNode = this.context.createDelay(SIDECHAIN_KEY_MAX_DELAY_SECONDS);
        keyDelayNode.delayTime.value = 0;
        const sourceNode = sourceStrip.analyserNode;
        sourceNode.connect(keyDelayNode);
        keyDelayNode.connect(scGain);
        scGain.connect(deviceNode.inputNode, 0, 1);
        this.sidechainConnections.set(key, {
            sourceTrackId,
            targetTrackId,
            targetDeviceId,
            sourceNode,
            keyDelayNode,
            appliedKeyDelaySec: 0,
            gainNode: scGain,
        });
    }

    /**
     * FX-5 — re-resolve every wired route's key alignment and glide the delay
     * lines onto it. Called on wire and once per scheduler tick, so a mid-session
     * latency push (a native plugin reporting a new lookahead, a device added or
     * bypassed) lands within one grain instead of holding a stale alignment for
     * the rest of the session. Nothing is cached across calls beyond the value
     * last written, which exists purely to keep an unchanged alignment from
     * scheduling AudioParam events every tick.
     */
    public refreshSidechainAlignment(keyDelayFor: SidechainKeyDelayResolver): void {
        if (this.fallbackMode || this.sidechainConnections.size === 0) {
            return;
        }
        const now = this.context.currentTime;
        for (const connection of this.sidechainConnections.values()) {
            const resolved = keyDelayFor({
                sourceTrackId: connection.sourceTrackId,
                targetTrackId: connection.targetTrackId,
                targetDeviceId: connection.targetDeviceId,
            });
            const nextSeconds = Math.min(Math.max(resolved, 0), SIDECHAIN_KEY_MAX_DELAY_SECONDS);
            if (Math.abs(nextSeconds - connection.appliedKeyDelaySec) < SIDECHAIN_KEY_DELAY_EPSILON_SECONDS) {
                continue;
            }
            // Same anchor-then-ramp idiom the automation writes use: a stepped
            // delayTime resamples the key and clicks, so re-anchor at the live
            // value, drop stale future events, and glide over one grain.
            const param = connection.keyDelayNode.delayTime;
            param.cancelScheduledValues(now);
            param.setValueAtTime(param.value, now);
            param.linearRampToValueAtTime(nextSeconds, now + SIDECHAIN_KEY_DELAY_RAMP_SECONDS);
            connection.appliedKeyDelaySec = nextSeconds;
        }
    }

    private removeLiveSidechainConnection(key: string): void {
        const connection = this.sidechainConnections.get(key);
        if (!connection) {
            return;
        }
        try {
            connection.sourceNode.disconnect(connection.keyDelayNode);
        } catch {
            // The source edge was already detached by a wider graph teardown.
        }
        try {
            connection.keyDelayNode.disconnect();
        } catch {
            // The alignment line was already detached by a wider graph teardown.
        }
        try {
            connection.gainNode.disconnect();
        } catch {
            // The target edge was already detached by a wider graph teardown.
        }
        this.sidechainConnections.delete(key);
    }

    public unwireSidechainRoute(sourceTrackId: string, targetDeviceId: string): void {
        const key = `${sourceTrackId}→${targetDeviceId}`;
        // Cancel a still-pending (queued-in-fallback) wire so an unwire issued
        // before recovery does not get replayed back into the live graph.
        this.pendingSidechainRoutes.delete(key);
        this.removeLiveSidechainConnection(key);
    }

    public scheduleOscillator(frequency: number, startTime: number, duration: number, gain = 0.3): void {
        this.assertActive();
        if (this.fallbackMode) {
            return;
        }
        const osc = this.context.createOscillator();
        const env = this.context.createGain();
        osc.type = 'sine';
        osc.frequency.value = frequency;
        env.gain.setValueAtTime(0, startTime);
        env.gain.linearRampToValueAtTime(gain, startTime + 0.005);
        env.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
        osc.connect(env);
        env.connect(this.masterGainNode);
        osc.start(startTime);
        osc.stop(startTime + duration);
        this.scheduledNodes.push(osc);
        osc.onended = () => {
            const idx = this.scheduledNodes.indexOf(osc);
            if (idx >= 0) {
                this.scheduledNodes.splice(idx, 1);
            }
            env.disconnect();
        };
    }

    public scheduleClick(time: number, accent: boolean, volume = 1): void {
        const freq = accent ? 1500 : 1000;
        const dur = accent ? 0.04 : 0.03;
        const baseVol = accent ? 0.4 : 0.25;
        this.scheduleOscillator(freq, time, dur, baseVol * volume);
    }

    public stopAllScheduled(): void {
        if (this.fallbackMode) {
            return;
        }
        const now = this.context.currentTime;
        for (const node of [...this.scheduledNodes]) {
            try {
                node.stop(now);
            } catch {
                // ignore
            }
        }
        this.scheduledNodes.length = 0;

        // Release held notes on every device that can hold one, through the
        // generic `controller.allNotesOff` every instrument descriptor already
        // publishes (`engine/wasmDeviceRegistry.ts`). This used to be a
        // hand-kept branch per device kind — a raw worklet postMessage for
        // Fermenter/Toaster plus explicit Grand Boule and Levain calls — which
        // meant every new instrument had to remember to add itself here or its
        // voices would keep sounding through a stop (audit MD-6). Reading the
        // registry's own surface instead means it cannot drift.
        //
        // One message per device, not a 128-note fan-out: each engine's
        // `allNotesOff` releases every voice internally. Levain in particular
        // uses it to skip the per-note realism release burst that 128 note-offs
        // would turn into an audible "ksshh".
        for (const [, trackNode] of this.trackNodes) {
            for (const dn of trackNode.strip.deviceNodes) {
                dn.controller?.allNotesOff?.();
            }
        }
    }

    public registerScheduledSource(node: AudioScheduledSourceNode): void {
        this.assertActive();
        if (this.fallbackMode) {
            return;
        }
        // Built-in synth and kit voices are bare oscillators written straight
        // into the strip; the scheduled path discarded the handle, so a stop or
        // a panic could not silence them and they rang on for the rest of their
        // programmed duration (audit MD-6). Tracking them here puts them under
        // the same `stopAllScheduled` sweep as the metronome.
        this.scheduledNodes.push(node);
        node.addEventListener('ended', () => {
            const index = this.scheduledNodes.indexOf(node);
            if (index >= 0) {
                this.scheduledNodes.splice(index, 1);
            }
        });
    }

    public resetGraph(): void {
        // Tear down all per-project audio graph state (tracks, buses, sends,
        // sidechain routes) without closing the AudioContext, master nodes,
        // or already-loaded worklet modules. Used when switching projects.
        this.stopAllScheduled();
        this.adjustmentRuntime.reset();
        for (const [key] of this.sidechainConnections) {
            this.removeLiveSidechainConnection(key);
        }
        // Drop sidechain routes queued during fallback: they belong to the
        // project being torn down and must not replay into the next one.
        this.pendingSidechainRoutes.clear();
        for (const send of Array.from(this.sendNodes.values())) {
            this.removeSend(send.sourceTrackId, send.busId);
        }
        for (const [id] of this.busNodes) {
            this.removeBusStrip(id);
        }
        for (const [id] of this.trackNodes) {
            this.removeTrackStrip(id);
        }
        this.toasterPadRoutes.clear();
        this.pendingDevicePromises.clear();
        this.deviceReadinessDiagnostics.reset();
        this.advanceRuntimeGraphRevision();
    }

    public applyAdjustmentLayerTick(records: AdjustmentLayerTickInput[]): void {
        this.assertActive();
        this.adjustmentRuntime.applyTick(records);
    }

    public resetAdjustmentLayers(): void {
        this.adjustmentRuntime.reset();
    }

    public listLiveAdjustmentBusKeys(): string[] {
        return this.adjustmentRuntime.listLiveBusKeys();
    }

    public dispose(): Promise<void> {
        this.disposalPromise ??= this.disposeOnce();
        return this.disposalPromise;
    }

    private async disposeOnce(): Promise<void> {
        // Invalidate loadWorklets before a stale continuation can rebuild the disposed graph.
        this.disposed = true;
        this.initializationGeneration++;
        this.initializationCancellation?.reject(new Error('Audio engine was disposed during initialization.'));
        this.initializationCancellation = null;
        this.initPromise = null;
        this.workletReady = false;

        // Tell every live worklet processor to shut down before we tear down the
        // graph and close the context, so processors stop their RT work cleanly.
        this.postShutdownToWorklets();

        // Tear down the per-project graph (tracks, buses, sends, sidechain,
        // adjustment-layer runtime). This also closes per-track meter ports.
        this.resetGraph();

        this.masterGainNode.disconnect();
        // Disconnect the master meter tap (inserted by wireMasterMeter into the
        // master chain) so it is not left dangling on the closed context.
        if (typeof AudioWorkletNode !== 'undefined' && this.masterMeterNode instanceof AudioWorkletNode) {
            try {
                this.masterMeterNode.disconnect();
            } catch {
                // already disconnected
            }
        }
        this.masterMeterNode = undefined;
        // Drop the view onto the meter SAB with the node that fed it, so a
        // post-dispose read reports "unavailable" instead of replaying whatever
        // the last block happened to leave in the buffer.
        this.masterMeterBuffer = null;
        this.masterAnalyser.disconnect();

        // Release the transport SAB / its view so the buffer can be GC'd and a
        // post-dispose setTransportInfo() no-ops instead of writing into a stale
        // buffer.
        this.transportSAB = null;
        this.transportView = null;
        this.transportSeqView = null;

        // Await the close so callers can sequence teardown; the dropped promise
        // previously hid close() failures and left the context not-yet-closed.
        await this.context.close();
    }

    private postShutdownToWorklets(): void {
        const shutdown = { type: 'shutdown' as const };
        const hasWorkletNode = typeof AudioWorkletNode !== 'undefined';
        if (hasWorkletNode && this.masterMeterNode instanceof AudioWorkletNode) {
            this.masterMeterNode.port.postMessage(shutdown);
        }
        for (const [, trackNode] of this.trackNodes) {
            trackNode.strip.meterNode?.port.postMessage(shutdown);
            for (const dn of trackNode.strip.deviceNodes) {
                for (const node of dn.nodes) {
                    if (hasWorkletNode && node instanceof AudioWorkletNode) {
                        node.port.postMessage(shutdown);
                    }
                }
            }
        }
    }
}

export function createAudioEngine(providedContext?: AudioContext): AudioEngine {
    return new AudioEngineImpl(providedContext);
}

export const audioEngine = createAudioEngine();
