import { logger } from '#/infra/logger/appLogger';
import { clampFaderGain } from '#/utils/audioLevelLaw';
import { hasSharedArrayBuffer } from '#/utils/capabilities';

import { SIDECHAIN_COMPRESSOR_WORKLET_OPTIONS } from '../models/BuiltinDeviceRuntime';
import { applyParams } from '../useCases/deviceResolvers/applyParams';
import { createBuiltinDeviceNode } from '../useCases/deviceResolvers/createBuiltinDeviceNode';

import { createNativePluginBridgeNode } from './NativePluginBridgeNode';
import { findWasmDescriptor } from './wasmDeviceRegistry';

import type {
    createDeviceReadinessDiagnostics,
    DeviceReadinessFailureStage,
    DeviceReadinessToken,
} from './deviceReadinessDiagnostics';
import type { TrackChannelStrip, BuiltinDeviceNode, DeviceController, SendNode } from '../models/AudioEngineState';
import type { RuntimeGraphDeviceChainDelta } from '../models/RuntimeGraphDelta';

/**
 * Minimum a-rate ramp span, in seconds, for a compensation-aligned automation
 * write (see `rampAutomationParam`). On a track that carries no PDC, the
 * requested land time equals `currentTime`; a zero-length ramp would step the
 * value — the very scheduler-grain stair-step RT-5 removes — so the ramp is
 * floored to this short glide instead. Sized at one scheduler grain so an
 * uncompensated track moves as smoothly as the old `setTargetAtTime(.., 0.01)`.
 */
const AUTOMATION_RAMP_MIN_SEC = 0.01;

export type TrackNodeDeps = {
    context: AudioContext;
    masterGainNode: GainNode;
    getBusGainNode: (id: string) => GainNode | undefined;
    getTrackGainNode: (id: string) => GainNode | undefined;
    getSendsForTrack: (tId: string) => SendNode[];
    pendingDevicePromises: Set<Promise<unknown>>;
    readinessDiagnostics: ReturnType<typeof createDeviceReadinessDiagnostics>;
    transportSAB?: SharedArrayBuffer;
    /** Adjustment-layer insert: when non-null for this track, `analyserNode`
     *  routes to this node instead of the track's default destination. */
    getAdjustmentBusForTrack?: (trackId: string) => AudioNode | null;
    reconnectRoutingForTrack?: (trackId: string) => void;
    onDeviceLoaded?: (trackId: string, device: BuiltinDeviceNode) => void;
    onDeviceRemoved?: (trackId: string, device: BuiltinDeviceNode) => void;
    onAsyncRuntimeGraphMutation?: (mutation: AsyncRuntimeGraphMutation) => void;
};

export type TrackNodeRuntimeGraphMutation = Readonly<{
    application: 'applied' | 'needs-reconcile';
    reason: string;
}>;

export type AsyncRuntimeGraphMutation = TrackNodeRuntimeGraphMutation;

/**
 * A TrackNode mutation changed live topology before its final graph operation
 * threw. The AudioEngine owns invalidation, so callers must not infer rollback.
 */
export class RuntimeGraphMutationFailure extends Error {
    constructor(
        public readonly mutation: TrackNodeRuntimeGraphMutation,
        public readonly cause: unknown,
        /** Failed compensation operation, if the original live mutation was not restored. */
        public readonly rollbackError?: unknown
    ) {
        super(cause instanceof Error ? cause.message : String(cause));
        this.name = 'RuntimeGraphMutationFailure';
    }
}

export type TrackNodeRuntimeGraphRejection = Readonly<{
    reason: string;
}>;

/** A prepared graph mutation failed before an untrusted live effect remained. */
export class RuntimeGraphMutationRejected extends Error {
    public readonly rejection: TrackNodeRuntimeGraphRejection;

    constructor(
        reason: string,
        public readonly cause: unknown
    ) {
        super(cause instanceof Error ? cause.message : String(cause));
        this.name = 'RuntimeGraphMutationRejected';
        this.rejection = Object.freeze({ reason });
    }
}

type PendingParameterWrite =
    | Readonly<{ kind: 'immediate'; name: string; value: number }>
    | Readonly<{ kind: 'scheduled'; name: string; value: number; sampleFrame: number }>;

type PendingDeviceLoad = {
    abortController: AbortController;
    externalInstanceId?: string;
    bypassed?: boolean;
    parameterIds: readonly string[];
    parameterWrites: PendingParameterWrite[];
    loadPromise?: Promise<unknown>;
    placeholder?: BuiltinDeviceNode;
    readinessToken: DeviceReadinessToken;
    resolved: boolean;
};

type InvalidatePendingDeviceLoadInput = {
    deviceId: string;
    failureStage?: DeviceReadinessFailureStage;
    abortPublished?: boolean;
    clearFailure?: boolean;
};

type DeviceLoadState = 'ready' | 'pending' | 'failed';

export class TrackNode {
    public strip: TrackChannelStrip;
    /** When SAB is unavailable, getPeakLevel falls back to AnalyserNode time-domain data. */
    private _analyserFallbackBuffer: Float32Array<ArrayBuffer> | null = null;
    // §88.3 — async plugin loads each resolve with a rebuildChain() call;
    // firing multiple of these in the same microtask produced overlapping
    // disconnect/reconnect sweeps. `_rebuildScheduled` coalesces them so at
    // most one rebuild runs per microtask turn.
    private _rebuildScheduled = false;
    private readonly _deviceReadinessTokens = new Map<string, DeviceReadinessToken>();
    private readonly _pendingGraphReadinessTokens = new Set<DeviceReadinessToken>();
    private _disposed = false;
    private _outputDestination: AudioNode | null = null;
    private readonly _failedDeviceLoads = new Set<string>();
    private readonly _pendingDeviceLoads = new Map<string, PendingDeviceLoad>();
    private readonly _runtimeRecoveryAttempts = new Set<string>();

    constructor(
        public trackId: string,
        private deps: TrackNodeDeps
    ) {
        const { context } = deps;
        const preFaderTap = context.createGain();
        preFaderTap.gain.value = 1;

        const gainNode = context.createGain();
        gainNode.gain.value = 1;

        const faderNode = context.createGain();
        faderNode.gain.value = 0.8;

        const postFaderGain = context.createGain();
        postFaderGain.gain.value = 1;

        const panNode = context.createStereoPanner();
        panNode.pan.value = 0;

        const analyserNode = context.createAnalyser();
        analyserNode.fftSize = 256;
        analyserNode.smoothingTimeConstant = 0.8;

        let meterNode: AudioWorkletNode | null = null;
        let meterBuffer: Float32Array;

        if (hasSharedArrayBuffer()) {
            // 4-byte SAB = one Float32: a single combined-peak meter. The
            // metering-processor scans every input channel into this one slot
            // (no `channels` field — that misleadingly implied per-channel peaks
            // the 1-float buffer cannot hold). getPeakLevel reads-and-resets it.
            const meterSab = new SharedArrayBuffer(4);
            meterNode = new AudioWorkletNode(context, 'metering-processor');
            meterNode.port.postMessage({ type: 'init', sab: meterSab });
            meterBuffer = new Float32Array(meterSab);
        } else {
            meterBuffer = new Float32Array(1);
            this._analyserFallbackBuffer = new Float32Array(analyserNode.fftSize);
        }

        gainNode.connect(preFaderTap);
        preFaderTap.connect(faderNode);
        faderNode.connect(postFaderGain);
        postFaderGain.connect(panNode);
        if (meterNode) {
            panNode.connect(meterNode);
            meterNode.connect(analyserNode);
        } else {
            panNode.connect(analyserNode);
        }

        this.strip = {
            trackId,
            preFaderTap,
            gainNode,
            faderNode,
            postFaderGain,
            panNode,
            meterNode,
            analyserNode,
            muted: false,
            soloGated: false,
            soloed: false,
            deviceNodes: [],
            midiFxNodes: [],
            meterBuffer,
        };

        this.routeOutput();
    }

    public addMidiFx(fxId: string, fxType: 'arp' | 'velocity' | 'probability'): void {
        this.strip.midiFxNodes.push({
            id: fxId,
            type: fxType,
            bypassed: false,
            parameterValues: {},
        });

        // Notify native engine if bridge is active
        const nativeDevice = this.strip.deviceNodes.find((d) => d.type === 'external-plugin');
        if (nativeDevice?.nativeDspControls) {
            // TODO: Send command to native bridge
        }
    }

    public removeMidiFx(fxId: string): void {
        this.strip.midiFxNodes = this.strip.midiFxNodes.filter((f) => f.id !== fxId);
    }

    public updateMidiFxParam(fxId: string, paramId: string, value: number): void {
        const fx = this.strip.midiFxNodes.find((f) => f.id === fxId);
        if (fx) {
            fx.parameterValues[paramId] = value;
        }
    }

    public updateMidiFxBypass(fxId: string, bypassed: boolean): void {
        const fx = this.strip.midiFxNodes.find((f) => f.id === fxId);
        if (fx) {
            fx.bypassed = bypassed;
        }
    }

    public registerTuningTable(frequencies: number[]): void {
        for (const dn of this.strip.deviceNodes) {
            // Knead is a relative pitch-shift editor, not a tuned instrument: its
            // WASM KneadInstance exposes only set_shift_semitones and has no
            // tuning-table consumer (the kneadProcessor 'param' handler acts on
            // 'shift_semitones' alone, so a posted 'tuning-table' was silently
            // dropped in the worklet). Do not post a param Knead cannot consume —
            // forward the table only to instruments that have a tuning input.
            if (dn.fermenterControls) {
                dn.fermenterControls.setParam('tuning-table', frequencies);
            }
        }
    }

    public setGain(gain: number): void {
        this.strip.faderNode.gain.setTargetAtTime(clampFaderGain(gain), this.deps.context.currentTime, 0.01);
    }

    public setPan(pan: number): void {
        this.strip.panNode.pan.setTargetAtTime(
            Math.max(-1, Math.min(1, pan / 50)),
            this.deps.context.currentTime,
            0.01
        );
    }

    /**
     * RT-5: sample-accurate, PDC-aligned automation write for the two track
     * families backed by a real native AudioParam — the fader `GainNode.gain`
     * and the `StereoPannerNode.pan`. `time` is the absolute context time at
     * which the value should be heard: the caller (Transport `applyAutomation`)
     * has already added the track's `getCompensationDelay`, so the automation
     * lands on the same delayed clock as the clips it shapes (scheduleAudioClips
     * uses the identical `getCurrentTime() + .. + compensation` mapping). Unlike
     * `setGain` (an immediate fader/VCA write anchored at `currentTime`), this
     * ramps a-rate to the target so the trajectory stays continuous across ticks
     * instead of stepping at the ~10ms scheduler grain.
     */
    public scheduleGainAutomation(gain: number, time: number): void {
        this.rampAutomationParam(this.strip.faderNode.gain, clampFaderGain(gain), time);
    }

    /** RT-5 companion to {@link scheduleGainAutomation} for the panner. `pan` is
     *  the canonical −50..50 range `setPan` accepts; it is scaled to −1..1. */
    public schedulePanAutomation(pan: number, time: number): void {
        this.rampAutomationParam(this.strip.panNode.pan, Math.max(-1, Math.min(1, pan / 50)), time);
    }

    /** PDC-aligned automation for one existing pre- or post-fader send. */
    public scheduleSendAutomation(busId: string, level: number, time: number): void {
        const send = this.deps.getSendsForTrack(this.trackId).find((candidate) => candidate.busId === busId);
        if (!send) {
            return;
        }
        this.rampAutomationParam(send.gainNode.gain, Math.max(0, Math.min(1, level)), time);
    }

    private rampAutomationParam(param: AudioParam, value: number, time: number): void {
        const now = this.deps.context.currentTime;
        // Never land before a minimum ramp past `now`: an uncompensated track
        // requests `time === now`, and a zero-length ramp would step.
        const landTime = Math.max(time, now + AUTOMATION_RAMP_MIN_SEC);
        // Re-anchor at the current value and drop stale future events so each
        // tick's ramp continues the trajectory rather than compounding onto an
        // older, already-scheduled target.
        param.cancelScheduledValues(now);
        param.setValueAtTime(param.value, now);
        param.linearRampToValueAtTime(value, landTime);
    }

    /**
     * RT-5: hold fader, pan, and send automation at their current values and drop any
     * pending scheduled automation ramp. Wired to transport stop so a ramp
     * scheduled toward a compensated future time does not keep gliding after
     * playback ends — the AudioParam analog of stopActiveSources' source
     * cleanup. Seek needs no equivalent: the scheduler keeps ticking, and the
     * next tick's rampAutomationParam re-anchors (cancelScheduledValues(now)),
     * dropping any stale ramp within one grain.
     */
    public cancelAutomationRamps(): void {
        const now = this.deps.context.currentTime;
        const sendParams = this.deps.getSendsForTrack(this.trackId).map((send) => send.gainNode.gain);
        for (const param of [this.strip.faderNode.gain, this.strip.panNode.pan, ...sendParams]) {
            param.cancelScheduledValues(now);
            param.setValueAtTime(param.value, now);
        }
    }

    public setMute(muted: boolean): void {
        this.strip.muted = muted;
        this.strip.postFaderGain.gain.setTargetAtTime(muted ? 0 : 1, this.deps.context.currentTime, 0.005);
    }

    /**
     * FX-8 — solo-in-place silencing, which is a different thing from the mute
     * button and must act at a different point of the strip.
     *
     * `setMute` zeroes `postFaderGain`, which sits downstream of `preFaderTap`.
     * That is deliberate: a pre-fader send is defined by tapping ahead of the
     * fader, and keeping it alive under mute is exactly what makes cue/monitor
     * sends work. But solo-in-place reuses that same mute path to silence every
     * track the engineer is *not* listening to, and those tracks then went on
     * feeding their pre-fader sends into the return buses — so soloing a vocal
     * still played the reverb tails of every "muted" track.
     *
     * The gate therefore closes `preFaderTap` itself. That node is upstream of
     * both send taps (`preFaderTap` / `analyserNode`), upstream of the sidechain
     * key tap, and — critically — upstream of where `scheduleFrozenTrack`
     * injects a frozen track's baked buffer, so a frozen track is gated by the
     * same single node as a live one. It is held separately from `muted` so the
     * two reasons never overwrite each other: releasing solo restores the tap
     * without touching a mute the user actually pressed.
     */
    public setSoloGate(gated: boolean): void {
        this.strip.soloGated = gated;
        this.strip.preFaderTap.gain.setTargetAtTime(gated ? 0 : 1, this.deps.context.currentTime, 0.005);
    }

    public getPeakLevel(): number {
        if (this._analyserFallbackBuffer) {
            this.strip.analyserNode.getFloatTimeDomainData(this._analyserFallbackBuffer);
            let peak = 0;
            for (let i = 0; i < this._analyserFallbackBuffer.length; i++) {
                const abs = Math.abs(this._analyserFallbackBuffer[i]!);
                if (abs > peak) {
                    peak = abs;
                }
            }
            return peak;
        }
        // Read-and-reset of a single f32, deliberately without Atomics (audit
        // RT-9) — the scalar-meter exception to the Atomics discipline the
        // multi-field telemetry slots follow. Rationale in the module header of
        // services/meteringProcessor.ts (the writer); the worst case is one
        // dropped peak frame, never a torn value.
        const peak = this.strip.meterBuffer[0]!;
        this.strip.meterBuffer[0] = 0;
        return peak;
    }

    public setOutput(outputId: string): boolean {
        if (this.strip.outputId === outputId) {
            return false;
        }

        let nextDestination: AudioNode;
        try {
            const adjustmentBus = this.deps.getAdjustmentBusForTrack?.(this.trackId) ?? null;
            nextDestination = adjustmentBus ?? this.getOutputDestination(outputId);
        } catch (error) {
            throw new RuntimeGraphMutationRejected(
                `Track ${this.trackId} output ${outputId} could not resolve a live destination`,
                error
            );
        }
        const previousDestination = this._outputDestination;
        if (previousDestination === nextDestination) {
            this.strip.outputId = outputId;
            return true;
        }

        let previousDestinationDisconnected = false;
        try {
            if (previousDestination) {
                this.strip.analyserNode.disconnect(previousDestination);
                previousDestinationDisconnected = true;
            }
            this.strip.analyserNode.connect(nextDestination);
        } catch (error) {
            if (!previousDestinationDisconnected) {
                throw new RuntimeGraphMutationRejected(
                    `Track ${this.trackId} output ${outputId} failed before changing its live route`,
                    error
                );
            }
            try {
                this.strip.analyserNode.disconnect(nextDestination);
                if (previousDestination) {
                    this.strip.analyserNode.connect(previousDestination);
                }
            } catch (rollbackError) {
                throw new RuntimeGraphMutationFailure(
                    Object.freeze({
                        application: 'needs-reconcile',
                        reason: `Track ${this.trackId} output ${outputId} changed before route restoration failed`,
                    }),
                    error,
                    rollbackError
                );
            }
            throw new RuntimeGraphMutationRejected(
                `Track ${this.trackId} output ${outputId} was restored after a live route failure`,
                error
            );
        }

        this.strip.outputId = outputId;
        this._outputDestination = nextDestination;
        return true;
    }

    public getDefaultDestination(): AudioNode {
        return this.getOutputDestination(this.strip.outputId);
    }

    private getOutputDestination(outputId: string | undefined): AudioNode {
        const { masterGainNode, getBusGainNode, getTrackGainNode } = this.deps;
        if (outputId === 'hw_out' || !outputId) {
            return masterGainNode;
        }
        const target = getBusGainNode(outputId) || getTrackGainNode(outputId);
        return target ?? masterGainNode;
    }

    public routeOutput(): void {
        const { analyserNode } = this.strip;
        const { getAdjustmentBusForTrack } = this.deps;
        const adjustmentBus = getAdjustmentBusForTrack?.(this.trackId) ?? null;
        const nextDestination = adjustmentBus ?? this.getDefaultDestination();
        if (this._outputDestination === nextDestination) {
            return;
        }
        if (this._outputDestination) {
            try {
                analyserNode.disconnect(this._outputDestination);
            } catch {
                // The owned output edge was already detached during a wider graph
                // teardown. Other analyser edges still must remain untouched.
            }
        }
        analyserNode.connect(nextDestination);
        this._outputDestination = nextDestination;
    }

    private reconnectSends(): void {
        const sends = this.deps.getSendsForTrack(this.trackId);
        for (const send of sends) {
            const tap = send.preFader ? this.strip.preFaderTap : this.strip.analyserNode;
            try {
                send.sourceNode.disconnect(send.gainNode);
            } catch {
                /* source edge already disconnected during chain teardown */
            }
            try {
                send.gainNode.disconnect();
            } catch {
                /* already disconnected */
            }
            tap.connect(send.gainNode);
            send.sourceNode = tap;

            const busGain = this.deps.getBusGainNode(send.busId);
            if (busGain) {
                send.gainNode.connect(busGain);
            }
        }
    }

    private reportAsyncRuntimeGraphMutation(
        application: AsyncRuntimeGraphMutation['application'],
        reason: string
    ): void {
        this.deps.onAsyncRuntimeGraphMutation?.(Object.freeze({ application, reason }));
    }

    private rollbackPromotedDevice(readinessToken: DeviceReadinessToken): boolean {
        const pendingLoad = this._pendingDeviceLoads.get(readinessToken.deviceId);
        if (
            !pendingLoad ||
            pendingLoad.readinessToken !== readinessToken ||
            !pendingLoad.resolved ||
            !pendingLoad.placeholder
        ) {
            return false;
        }
        const index = this.strip.deviceNodes.findIndex(
            (device) => device.deviceId === readinessToken.deviceId && device !== pendingLoad.placeholder
        );
        if (index === -1) {
            return false;
        }

        const failedDevice = this.strip.deviceNodes[index];
        if (!failedDevice) {
            return false;
        }
        this.reportAsyncRuntimeGraphMutation(
            'needs-reconcile',
            `Async device promotion for ${readinessToken.deviceId} rolled back after a live graph failure`
        );
        this.strip.deviceNodes[index] = pendingLoad.placeholder;
        pendingLoad.abortController.abort();
        try {
            this.deps.onDeviceRemoved?.(this.trackId, failedDevice);
        } catch (error) {
            logger.warn(`[WebAudioEngine] Device graph rollback notification failed: ${String(error)}`);
        }
        this.destroyPublishedDeviceNode(failedDevice);
        return true;
    }

    /** Coalesce concurrent rebuild requests into a single microtask (§88.3). */
    public scheduleRebuildChain(): void {
        if (this._disposed || this._rebuildScheduled) {
            return;
        }
        this._rebuildScheduled = true;
        queueMicrotask(() => {
            this._rebuildScheduled = false;
            if (this._disposed) {
                return;
            }
            try {
                this.rebuildChain();
                for (const token of this._pendingGraphReadinessTokens) {
                    this.deps.readinessDiagnostics.markGraphReady({ token });
                }
            } catch (error) {
                for (const token of this._pendingGraphReadinessTokens) {
                    this._failedDeviceLoads.add(token.deviceId);
                    this.deps.readinessDiagnostics.markFailed({ token, stage: 'graph' });
                    this.rollbackPromotedDevice(token);
                }
                try {
                    this.rebuildChain();
                } catch (rollbackError) {
                    logger.warn(`[WebAudioEngine] Device graph rollback failed: ${String(rollbackError)}`);
                }
                logger.warn(`[WebAudioEngine] Device graph rebuild failed: ${String(error)}`);
            } finally {
                this._pendingGraphReadinessTokens.clear();
            }
        });
    }

    public rebuildChain(): void {
        if (this._disposed) {
            return;
        }
        const s = this.strip;
        s.preFaderTap.disconnect();
        s.gainNode.disconnect();
        s.faderNode.disconnect();
        s.postFaderGain.disconnect();
        s.panNode.disconnect();
        s.meterNode?.disconnect();

        for (const dn of s.deviceNodes) {
            try {
                dn.outputNode.disconnect();
            } catch {
                /* ok */
            }
        }

        let prevs: AudioNode[] = [s.gainNode];
        for (const dn of s.deviceNodes) {
            if (dn.bypassed) {
                continue;
            }
            if (!dn.isGenerator && dn.inputNode.numberOfInputs > 0) {
                // Effect: all previous outputs connect to this input
                for (const p of prevs) {
                    p.connect(dn.inputNode);
                }
                prevs = [dn.outputNode];
            } else {
                // Generator (Instrument): adds its output to the signal path
                prevs.push(dn.outputNode);
            }
        }

        // Connect all final outputs to the preFaderTap
        for (const p of prevs) {
            p.connect(s.preFaderTap);
        }
        s.preFaderTap.connect(s.faderNode);
        s.faderNode.connect(s.postFaderGain);
        s.postFaderGain.connect(s.panNode);
        if (s.meterNode) {
            s.panNode.connect(s.meterNode);
            s.meterNode.connect(s.analyserNode);
        } else {
            s.panNode.connect(s.analyserNode);
        }

        this.routeOutput();
        if (this.deps.reconnectRoutingForTrack) {
            this.deps.reconnectRoutingForTrack(this.trackId);
        } else {
            this.reconnectSends();
        }
    }

    private createPlaceholderController(
        deviceId: string,
        pendingLoad: PendingDeviceLoad,
        controller?: DeviceController
    ): DeviceController {
        return {
            ...controller,
            ready: false,
            setParam: (name, value, sampleFrame) => {
                if (this._disposed || pendingLoad.resolved || this._pendingDeviceLoads.get(deviceId) !== pendingLoad) {
                    return;
                }
                if (sampleFrame !== undefined && Number.isSafeInteger(sampleFrame) && sampleFrame >= 0) {
                    pendingLoad.parameterWrites.push(Object.freeze({ kind: 'scheduled', name, value, sampleFrame }));
                    return;
                }
                const previous = pendingLoad.parameterWrites.at(-1);
                if (previous?.kind === 'immediate' && previous.name === name) {
                    pendingLoad.parameterWrites[pendingLoad.parameterWrites.length - 1] = Object.freeze({
                        kind: 'immediate',
                        name,
                        value,
                    });
                    return;
                }
                pendingLoad.parameterWrites.push(Object.freeze({ kind: 'immediate', name, value }));
            },
        };
    }

    private registerPendingDeviceLoad(
        deviceId: string,
        pendingLoad: PendingDeviceLoad,
        loadPromise: Promise<unknown>
    ): void {
        pendingLoad.loadPromise = loadPromise;
        this._pendingDeviceLoads.set(deviceId, pendingLoad);
        this.deps.pendingDevicePromises.add(loadPromise);
        void loadPromise.finally(() => {
            if (this._pendingDeviceLoads.get(deviceId) === pendingLoad) {
                this.invalidatePendingDeviceLoad({
                    deviceId,
                    failureStage: pendingLoad.resolved ? undefined : 'node',
                });
            } else {
                this.deps.pendingDevicePromises.delete(loadPromise);
            }
        });
    }

    private invalidatePendingDeviceLoad({
        deviceId,
        failureStage,
        abortPublished = false,
        clearFailure = false,
    }: InvalidatePendingDeviceLoadInput): void {
        if (failureStage) {
            this._failedDeviceLoads.add(deviceId);
        } else if (clearFailure) {
            this._failedDeviceLoads.delete(deviceId);
        }
        const pendingLoad = this._pendingDeviceLoads.get(deviceId);
        if (!pendingLoad) {
            return;
        }
        this._pendingDeviceLoads.delete(deviceId);
        if (failureStage) {
            this._pendingGraphReadinessTokens.delete(pendingLoad.readinessToken);
            this.deps.readinessDiagnostics.markFailed({ token: pendingLoad.readinessToken, stage: failureStage });
        } else if (!pendingLoad.resolved) {
            this.deps.readinessDiagnostics.cancel(pendingLoad.readinessToken);
        }
        pendingLoad.parameterWrites.length = 0;
        if (!pendingLoad.resolved || abortPublished) {
            pendingLoad.abortController.abort();
        }
        if (pendingLoad.loadPromise) {
            this.deps.pendingDevicePromises.delete(pendingLoad.loadPromise);
        }
    }

    private completePendingDeviceLoad(
        deviceId: string,
        pendingLoad: PendingDeviceLoad,
        finalDn: BuiltinDeviceNode
    ): boolean {
        const isCurrentLoad = this._pendingDeviceLoads.get(deviceId) === pendingLoad;
        const index = this.strip.deviceNodes.findIndex((device) => device.deviceId === deviceId);
        if (this._disposed || !isCurrentLoad || pendingLoad.resolved || index === -1) {
            if (isCurrentLoad && !pendingLoad.resolved) {
                this.invalidatePendingDeviceLoad({ deviceId });
            }
            this.destroyRejectedDeviceNode(finalDn);
            return false;
        }

        let deviceLoadNotificationStarted = false;
        let promotionPublished = false;
        try {
            finalDn.parameterIds = pendingLoad.parameterIds;
            finalDn.externalInstanceId = pendingLoad.externalInstanceId;
            for (const pending of pendingLoad.parameterWrites) {
                if (pending.kind === 'scheduled') {
                    finalDn.controller?.setParam(pending.name, pending.value, pending.sampleFrame);
                } else {
                    finalDn.controller?.setParam(pending.name, pending.value);
                }
            }
            if (pendingLoad.bypassed !== undefined) {
                finalDn.controller?.setBypass?.(pendingLoad.bypassed);
                finalDn.bypassed = pendingLoad.bypassed;
            }
            // This owner callback reserves the next runtime graph generation
            // before the placeholder reference changes, so no caller can apply
            // a delta in the promotion/rebuild gap with the old generation.
            this.reportAsyncRuntimeGraphMutation(
                'applied',
                `Async device ${deviceId} promoted from its placeholder into the live graph`
            );
            this.strip.deviceNodes[index] = finalDn;
            promotionPublished = true;
            if (this.deps.onDeviceLoaded) {
                deviceLoadNotificationStarted = true;
                this.deps.onDeviceLoaded(this.trackId, finalDn);
            }
        } catch (error) {
            if (promotionPublished) {
                this.reportAsyncRuntimeGraphMutation(
                    'needs-reconcile',
                    `Async device ${deviceId} promotion failed after a live graph mutation`
                );
            }
            if (pendingLoad.placeholder) {
                this.strip.deviceNodes[index] = pendingLoad.placeholder;
            }
            if (deviceLoadNotificationStarted) {
                try {
                    this.deps.onDeviceRemoved?.(this.trackId, finalDn);
                } catch (rollbackError) {
                    logger.warn(`[WebAudioEngine] Device promotion rollback failed: ${String(rollbackError)}`);
                }
            }
            this.invalidatePendingDeviceLoad({ deviceId, failureStage: 'node' });
            this.destroyRejectedDeviceNode(finalDn);
            throw error;
        }

        pendingLoad.resolved = true;
        this._failedDeviceLoads.delete(deviceId);
        pendingLoad.parameterWrites.length = 0;
        this.deps.readinessDiagnostics.markNodeReady({ token: pendingLoad.readinessToken });
        this._pendingGraphReadinessTokens.add(pendingLoad.readinessToken);
        this.scheduleRebuildChain();
        return true;
    }

    private failLoadedDevice(deviceId: string, failedDn: BuiltinDeviceNode, replacementDn: BuiltinDeviceNode): boolean {
        const index = this.strip.deviceNodes.findIndex((device) => device === failedDn && device.deviceId === deviceId);
        if (this._disposed || index === -1) {
            return false;
        }

        this._failedDeviceLoads.add(deviceId);
        const readinessToken = this._deviceReadinessTokens.get(deviceId);
        if (readinessToken) {
            this.deps.readinessDiagnostics.markFailed({ token: readinessToken, stage: 'runtime' });
        }
        this.reportAsyncRuntimeGraphMutation(
            'needs-reconcile',
            `Loaded device ${deviceId} failed at runtime and requires graph reconciliation`
        );
        replacementDn.bypassed = failedDn.bypassed;
        this.strip.deviceNodes[index] = replacementDn;
        this._pendingDeviceLoads.get(deviceId)?.abortController.abort();
        this.scheduleRebuildChain();
        return true;
    }

    private scheduleFailedDeviceRecovery(deviceId: string, replacementDn: BuiltinDeviceNode): void {
        if (this._disposed || this._runtimeRecoveryAttempts.has(deviceId) || !this._failedDeviceLoads.has(deviceId)) {
            return;
        }
        if (!this.strip.deviceNodes.some((device) => device === replacementDn && device.deviceId === deviceId)) {
            return;
        }

        this._runtimeRecoveryAttempts.add(deviceId);
        queueMicrotask(() => {
            const index = this.strip.deviceNodes.findIndex(
                (device) => device === replacementDn && device.deviceId === deviceId
            );
            if (this._disposed || !this._failedDeviceLoads.has(deviceId) || index === -1) {
                return;
            }

            const precedingDeviceIds = this.strip.deviceNodes.slice(0, index).map((device) => device.deviceId);
            const { bypassed, type, parameterIds } = replacementDn;
            this.reportAsyncRuntimeGraphMutation(
                'needs-reconcile',
                `Recovered device ${deviceId} is rebuilding its live graph slot`
            );
            this.invalidatePendingDeviceLoad({ deviceId });
            this.strip.deviceNodes.splice(index, 1);
            this.destroyRejectedDeviceNode(replacementDn);
            this.addDevice(deviceId, type, undefined, precedingDeviceIds, parameterIds);
            if (bypassed !== undefined) {
                this.updateBypass(deviceId, bypassed);
            }
        });
    }

    public timeoutPendingDeviceLoads(): void {
        let graphChanged = false;
        for (const [deviceId, pendingLoad] of this._pendingDeviceLoads) {
            let failureStage: DeviceReadinessFailureStage = 'node';
            if (pendingLoad.resolved) {
                failureStage = this._pendingGraphReadinessTokens.has(pendingLoad.readinessToken) ? 'graph' : 'content';
                graphChanged = this.rollbackPromotedDevice(pendingLoad.readinessToken) || graphChanged;
            }
            this.invalidatePendingDeviceLoad({ deviceId, failureStage, abortPublished: true });
        }
        if (graphChanged) {
            this.scheduleRebuildChain();
        }
    }

    public getDeviceLoadState(deviceId: string): DeviceLoadState {
        const readinessToken = this._deviceReadinessTokens.get(deviceId);
        if (readinessToken) {
            const readinessState = this.deps.readinessDiagnostics.getLoadState(readinessToken);
            if (readinessState) {
                return readinessState;
            }
        }
        if (this._failedDeviceLoads.has(deviceId)) {
            return 'failed';
        }
        const pendingLoad = this._pendingDeviceLoads.get(deviceId);
        if (pendingLoad) {
            return pendingLoad.resolved ? 'ready' : 'pending';
        }
        return 'ready';
    }

    private disconnectDeviceNode(device: BuiltinDeviceNode): void {
        for (const node of device.nodes) {
            try {
                node.disconnect();
            } catch {
                // A node may already be detached when a pending load resolves late.
            }
        }
    }

    private destroyRejectedDeviceNode(device: BuiltinDeviceNode): void {
        if (device.dispose) {
            device.dispose();
        } else if (device.controller) {
            device.controller.destroy?.();
        }
        this.disconnectDeviceNode(device);
    }

    private destroyPublishedDeviceNode(device: BuiltinDeviceNode): void {
        if (device.controller?.destroy) {
            device.controller.destroy();
        } else if (device.dispose) {
            device.dispose();
        }
        this.disconnectDeviceNode(device);
    }

    private failDeviceConstruction(
        readinessToken: DeviceReadinessToken,
        error: unknown,
        partialDevice?: BuiltinDeviceNode
    ): never {
        if (partialDevice) {
            this.destroyRejectedDeviceNode(partialDevice);
        }
        this.deps.readinessDiagnostics.markFailed({ token: readinessToken, stage: 'node' });
        throw error;
    }

    private throwUncompensatedDeviceAddFailure(deviceId: string, error: unknown, rollbackError: unknown): never {
        throw new RuntimeGraphMutationFailure(
            Object.freeze({
                application: 'needs-reconcile',
                reason: `Device ${deviceId} was added before its live graph rebuild and rollback failed`,
            }),
            error,
            rollbackError
        );
    }

    public addDevice(
        deviceId: string,
        deviceType: string,
        externalInstanceId?: string,
        precedingDeviceIds?: readonly string[],
        parameterIds: readonly string[] = []
    ): boolean {
        if (this._disposed) {
            return false;
        }
        if (this.strip.deviceNodes.some((d) => d.deviceId === deviceId)) {
            logger.debug(`Device ${deviceId} already exists on track ${this.trackId}`);
            return false;
        }

        const { context } = this.deps;
        const descriptor = findWasmDescriptor(deviceType);
        const readinessToken = this.deps.readinessDiagnostics.begin({
            deviceId,
            deviceType,
            requiresContent: descriptor?.requiresContent ?? false,
        });
        this._deviceReadinessTokens.set(deviceId, readinessToken);
        let dn: BuiltinDeviceNode;
        let awaitsAsyncNode = false;

        if (deviceType === 'builtin-sidechain-compressor') {
            let workletNode: AudioWorkletNode;
            try {
                workletNode = new AudioWorkletNode(
                    context,
                    'sidechain-compressor-processor',
                    SIDECHAIN_COMPRESSOR_WORKLET_OPTIONS
                );
            } catch (error) {
                this.failDeviceConstruction(readinessToken, error);
            }
            dn = { deviceId, type: deviceType, nodes: [workletNode], inputNode: workletNode, outputNode: workletNode };
            dn.controller = {
                setParam: (name: string, value: number) => {
                    const param = workletNode.parameters.get(name.replace('sc-comp-', ''));
                    if (param) {
                        if (name === 'sc-comp-attack' || name === 'sc-comp-release') {
                            param.setTargetAtTime(value / 1000, this.deps.context.currentTime, 0.01);
                        } else {
                            param.setTargetAtTime(value, this.deps.context.currentTime, 0.01);
                        }
                    }
                },
                setBypass: (bypassed: boolean) => {
                    dn!.bypassed = bypassed;
                    this.scheduleRebuildChain();
                },
                destroy: () => {},
            };
        } else if (deviceType === 'external-plugin') {
            // Native plugin bridge: relays audio between Web Audio and the Rust
            // cpal audio thread. A SharedArrayBuffer cannot reach the host
            // process, so the hop to Rust is IPC; the instance id is the key.
            let loadingBypass: GainNode;
            try {
                loadingBypass = context.createGain();
            } catch (error) {
                this.failDeviceConstruction(readinessToken, error);
            }
            const pendingLoad: PendingDeviceLoad = {
                abortController: new AbortController(),
                ...(externalInstanceId !== undefined ? { externalInstanceId } : {}),
                parameterIds: Object.freeze([...parameterIds]),
                parameterWrites: [],
                readinessToken,
                resolved: false,
            };
            awaitsAsyncNode = true;
            dn = {
                deviceId,
                type: deviceType,
                nodes: [loadingBypass],
                inputNode: loadingBypass,
                outputNode: loadingBypass,
            };

            const loadingControls = this.createPlaceholderController(deviceId, pendingLoad, {
                setParam: () => {},
                setBypass: () => {},
                destroy: () => {},
            });
            dn.nativeDspControls = {
                setParam: loadingControls.setParam,
                setBypass: (bypassed) => loadingControls.setBypass?.(bypassed),
            };
            dn.controller = loadingControls;
            pendingLoad.placeholder = dn;

            let loadPromise: Promise<void>;
            try {
                loadPromise = createNativePluginBridgeNode(context, externalInstanceId ?? deviceId)
                    .then((result) => {
                        const controls = {
                            setParam: (name: string, value: number) => result.setParam(parseInt(name, 10) || 0, value),
                            setBypass: result.setBypass,
                            destroy: result.destroy,
                        };
                        const bridgeDn: BuiltinDeviceNode = {
                            deviceId,
                            type: deviceType,
                            nodes: [result.workletNode],
                            inputNode: result.workletNode,
                            outputNode: result.workletNode,
                            nativeDspControls: controls,
                            controller: controls,
                            dispose: result.destroy,
                        };
                        this.completePendingDeviceLoad(deviceId, pendingLoad, bridgeDn);
                        return;
                    })
                    .catch((error) => logger.warn(`[WebAudioEngine] Native plugin bridge failed: ${String(error)}`));
            } catch (error) {
                this.failDeviceConstruction(readinessToken, error, dn);
            }
            this.registerPendingDeviceLoad(deviceId, pendingLoad, loadPromise);
        } else {
            let factoryNode: ReturnType<typeof createBuiltinDeviceNode>;
            try {
                factoryNode = createBuiltinDeviceNode({ context, deviceType });
            } catch (error) {
                this.failDeviceConstruction(readinessToken, error);
            }
            if (factoryNode) {
                dn = {
                    deviceId,
                    type: deviceType,
                    nodes: factoryNode.nodes,
                    inputNode: factoryNode.inputNode,
                    outputNode: factoryNode.outputNode,
                    dispose: factoryNode.dispose,
                };
                dn.controller = {
                    setParam: (name: string, value: number) => applyParams(factoryNode, dn.type, { [name]: value }),
                    setBypass: (bypassed: boolean) => {
                        dn!.bypassed = bypassed;
                        this.scheduleRebuildChain();
                    },
                    destroy: () => {
                        if (factoryNode.dispose) {
                            factoryNode.dispose();
                        }
                    },
                };
            } else {
                if (!descriptor) {
                    this.deps.readinessDiagnostics.markFailed({ token: readinessToken, stage: 'node' });
                    return false;
                }
                const pendingLoad: PendingDeviceLoad = {
                    abortController: new AbortController(),
                    parameterIds: Object.freeze([...parameterIds]),
                    parameterWrites: [],
                    readinessToken,
                    resolved: false,
                };
                awaitsAsyncNode = true;
                let created: ReturnType<typeof descriptor.create>;
                try {
                    created = descriptor.create({
                        context,
                        trackId: this.trackId,
                        deviceId,
                        deviceType,
                        parameterIds: pendingLoad.parameterIds,
                        transportSAB: this.deps.transportSAB,
                        isCurrent: () => this._pendingDeviceLoads.get(deviceId) === pendingLoad && !this._disposed,
                        signal: pendingLoad.abortController.signal,
                        onLoaded: (finalDn) => this.completePendingDeviceLoad(deviceId, pendingLoad, finalDn),
                        onContentLoadSettled: (outcome) => {
                            if (outcome === 'failed') {
                                this._failedDeviceLoads.add(deviceId);
                            }
                            this.deps.readinessDiagnostics.markContentSettled({ token: readinessToken, outcome });
                        },
                        onRuntimeFailure: (failedDn, replacementDn) =>
                            this.failLoadedDevice(deviceId, failedDn, replacementDn),
                        onRuntimeRecovery: (replacementDn) =>
                            this.scheduleFailedDeviceRecovery(deviceId, replacementDn),
                    });
                } catch (error) {
                    this.failDeviceConstruction(readinessToken, error);
                }
                const { placeholder, loadPromise } = created;
                if (!placeholder.controller) {
                    placeholder.controller = this.createPlaceholderController(deviceId, pendingLoad);
                }
                dn = placeholder;
                pendingLoad.placeholder = placeholder;
                this.registerPendingDeviceLoad(deviceId, pendingLoad, loadPromise);
            }
        }

        dn.parameterIds = Object.freeze([...parameterIds]);
        dn.externalInstanceId = externalInstanceId;
        let targetIndex = this.strip.deviceNodes.length;
        if (precedingDeviceIds !== undefined) {
            const precedingIds = new Set(precedingDeviceIds);
            targetIndex = 0;
            for (const [index, existingDevice] of this.strip.deviceNodes.entries()) {
                if (precedingIds.has(existingDevice.deviceId)) {
                    targetIndex = index + 1;
                }
            }
        }
        this.strip.deviceNodes.splice(targetIndex, 0, dn);
        if (awaitsAsyncNode) {
            try {
                this.rebuildChain();
            } catch (error) {
                try {
                    this.invalidatePendingDeviceLoad({ deviceId, failureStage: 'graph' });
                    this.strip.deviceNodes = this.strip.deviceNodes.filter((device) => device.deviceId !== deviceId);
                    this.destroyRejectedDeviceNode(dn);
                    this.rebuildChain();
                } catch (rollbackError) {
                    this.throwUncompensatedDeviceAddFailure(deviceId, error, rollbackError);
                }
                throw error;
            }
            return true;
        }
        this.deps.readinessDiagnostics.markNodeReady({ token: readinessToken });
        try {
            this.rebuildChain();
            this.deps.readinessDiagnostics.markGraphReady({ token: readinessToken });
        } catch (error) {
            this._failedDeviceLoads.add(deviceId);
            try {
                this.deps.readinessDiagnostics.markFailed({ token: readinessToken, stage: 'graph' });
                this.strip.deviceNodes.splice(targetIndex, 1);
                this.destroyRejectedDeviceNode(dn);
                this.rebuildChain();
            } catch (rollbackError) {
                this.throwUncompensatedDeviceAddFailure(deviceId, error, rollbackError);
            }
            throw error;
        }
        return true;
    }

    public removeDevice(deviceId: string): boolean {
        this.invalidatePendingDeviceLoad({ deviceId, abortPublished: true, clearFailure: true });
        const readinessToken = this._deviceReadinessTokens.get(deviceId);
        if (readinessToken) {
            this._pendingGraphReadinessTokens.delete(readinessToken);
            this.deps.readinessDiagnostics.removeDevice(readinessToken);
            this._deviceReadinessTokens.delete(deviceId);
        }
        this._runtimeRecoveryAttempts.delete(deviceId);
        const dn = this.strip.deviceNodes.find((d) => d.deviceId === deviceId);
        if (!dn) {
            return false;
        }

        this.strip.deviceNodes = this.strip.deviceNodes.filter((d) => d.deviceId !== deviceId);
        try {
            this.deps.onDeviceRemoved?.(this.trackId, dn);
            this.destroyPublishedDeviceNode(dn);
            this.rebuildChain();
        } catch (error) {
            throw new RuntimeGraphMutationFailure(
                Object.freeze({
                    application: 'needs-reconcile',
                    reason: `Device ${deviceId} was removed before its live graph rebuild failed`,
                }),
                error
            );
        }
        return true;
    }

    /** Applies one compiler-validated, ordered device-chain transition. */
    public applyDeviceChain(delta: RuntimeGraphDeviceChainDelta): boolean {
        const beforeIds = new Set(delta.before.devices.map((device) => device.id));
        const afterIds = new Set(delta.after.devices.map((device) => device.id));
        if (delta.operation === 'add-device') {
            const added = delta.after.devices.find((device) => !beforeIds.has(device.id));
            if (!added) {
                throw new RuntimeGraphMutationRejected('Compiled device add has no inserted device', delta);
            }
            const insertionIndex = delta.after.devices.findIndex((device) => device.id === added.id);
            return this.addDevice(
                added.id,
                added.type,
                added.externalInstanceId,
                delta.after.devices.slice(0, insertionIndex).map((device) => device.id),
                added.parameterIds
            );
        }
        if (delta.operation === 'remove-device') {
            const removed = delta.before.devices.find((device) => !afterIds.has(device.id));
            if (!removed) {
                throw new RuntimeGraphMutationRejected('Compiled device removal has no removed device', delta);
            }
            return this.removeDevice(removed.id);
        }

        if (delta.operation === 'replace-device-chain') {
            let changed = false;
            try {
                for (const device of [...this.strip.deviceNodes]) {
                    changed = this.removeDevice(device.deviceId) || changed;
                }
                for (const device of delta.after.devices) {
                    const added = this.addDevice(
                        device.id,
                        device.type,
                        device.externalInstanceId,
                        undefined,
                        device.parameterIds
                    );
                    if (!added) {
                        throw new RuntimeGraphMutationRejected(
                            `Compiled device-chain replacement could not add ${device.id}`,
                            delta
                        );
                    }
                    changed = true;
                }
                return changed;
            } catch (error) {
                // Once an old slot has been disposed or a new slot published, a
                // restoration would need fresh host/worklet resources. Report
                // that truthfully instead of claiming the CRDT commit was undone.
                if (changed) {
                    throw new RuntimeGraphMutationFailure(
                        Object.freeze({
                            application: 'needs-reconcile',
                            reason: `Device-chain replacement on track ${this.trackId} partially changed the live graph`,
                        }),
                        error
                    );
                }
                throw error;
            }
        }

        const currentNodes = [...this.strip.deviceNodes];
        const nodesById = new Map(currentNodes.map((device) => [device.deviceId, device]));
        const orderedNodes: BuiltinDeviceNode[] = [];
        for (const device of delta.after.devices) {
            const liveDevice = nodesById.get(device.id);
            if (!liveDevice) {
                throw new RuntimeGraphMutationRejected('Compiled device reorder has no live device', delta);
            }
            orderedNodes.push(liveDevice);
        }
        this.strip.deviceNodes = orderedNodes;
        try {
            this.rebuildChain();
        } catch (error) {
            this.strip.deviceNodes = currentNodes;
            try {
                this.rebuildChain();
            } catch (rollbackError) {
                throw new RuntimeGraphMutationFailure(
                    Object.freeze({
                        application: 'needs-reconcile',
                        reason: `Device-chain reorder on track ${this.trackId} changed before graph restoration failed`,
                    }),
                    error,
                    rollbackError
                );
            }
            throw new RuntimeGraphMutationRejected(
                `Device-chain reorder on track ${this.trackId} was restored after a live graph failure`,
                error
            );
        }
        return true;
    }

    public updateParam(deviceId: string, paramId: string, value: number): void {
        const dn = this.strip.deviceNodes.find((d) => d.deviceId === deviceId);
        if (!dn || !dn.controller) {
            return;
        }
        dn.controller.setParam(paramId, value);
    }

    public updatePatch(deviceId: string, patch: Record<string, unknown>): void {
        const dn = this.strip.deviceNodes.find((d) => d.deviceId === deviceId);
        if (!dn || !dn.controller) {
            return;
        }
        if (dn.controller.setPatch) {
            dn.controller.setPatch(patch);
        }
    }

    public scheduleParam(deviceId: string, paramId: string, value: number, time: number): void {
        const dn = this.strip.deviceNodes.find((d) => d.deviceId === deviceId);
        if (!dn || !dn.controller) {
            return;
        }

        if (dn.controller.scheduleParam) {
            dn.controller.scheduleParam(paramId, value, time);
            return;
        }

        // MessagePort-based devices (Fermenter, Toaster, Grand Boule, etc.) schedule
        // via their internal sample-frame queue — setParam's third arg is that hint.
        const sampleFrame = Math.round(time * this.deps.context.sampleRate);
        dn.controller.setParam(paramId, value, sampleFrame);
    }

    public scheduleDeviceKeyOn(deviceId: string, pitch: number, velocity: number, time?: number): void {
        const dn = this.strip.deviceNodes.find((d) => d.deviceId === deviceId);
        dn?.controller?.keyOn?.(0, pitch, velocity, time);
    }

    public scheduleDeviceKeyOff(deviceId: string, pitch: number, velocity: number, time?: number): void {
        const dn = this.strip.deviceNodes.find((d) => d.deviceId === deviceId);
        dn?.controller?.keyOff?.(0, pitch, velocity, time);
    }

    public updateBypass(deviceId: string, bypassed: boolean): boolean {
        const dn = this.strip.deviceNodes.find((d) => d.deviceId === deviceId);
        if (!dn) {
            return false;
        }
        const changed = dn.bypassed !== bypassed;
        const pendingLoad = this._pendingDeviceLoads.get(deviceId);
        if (pendingLoad && !pendingLoad.resolved) {
            pendingLoad.bypassed = bypassed;
        }
        dn.controller?.setBypass?.(bypassed);
        // WASM instruments (Fermenter / Grand Boule / Levain) keep their worklet
        // running on bypass — their setBypass only flips a JS flag that gates new
        // noteOn, so any voices already held keep sounding. Releasing all voices
        // when entering bypass stops the held audio at its source.
        if (bypassed && dn.controller?.allNotesOff) {
            dn.controller.allNotesOff();
        }
        // Drive the device in/out of the signal chain like an effect bypass: a
        // bypassed generator is skipped by rebuildChain (its output is no longer
        // summed into the strip), so even a synth whose controller cannot release
        // voices is removed from the audible path. Idempotent for effects whose
        // own setBypass already set dn.bypassed + scheduled a rebuild.
        if (changed) {
            dn.bypassed = bypassed;
            this.scheduleRebuildChain();
        }
        return changed;
    }

    public dispose(): void {
        if (this._disposed) {
            return;
        }
        this._disposed = true;
        this._rebuildScheduled = false;
        this._pendingGraphReadinessTokens.clear();
        for (const deviceId of this._pendingDeviceLoads.keys()) {
            this.invalidatePendingDeviceLoad({ deviceId, abortPublished: true, clearFailure: true });
        }
        for (const readinessToken of this._deviceReadinessTokens.values()) {
            this.deps.readinessDiagnostics.removeDevice(readinessToken);
        }
        this._deviceReadinessTokens.clear();
        this._failedDeviceLoads.clear();
        this._runtimeRecoveryAttempts.clear();
        this.strip.preFaderTap.disconnect();
        this.strip.gainNode.disconnect();
        this.strip.faderNode.disconnect();
        this.strip.postFaderGain.disconnect();
        this.strip.panNode.disconnect();
        this.strip.analyserNode.disconnect();
        this._outputDestination = null;
        if (this.strip.meterNode) {
            this.strip.meterNode.port.postMessage({ type: 'shutdown' });
            this.strip.meterNode.port.close();
            this.strip.meterNode.disconnect();
        }
        for (const dn of this.strip.deviceNodes) {
            if (dn.controller) {
                dn.controller.destroy?.();
            } else if (dn.dispose) {
                dn.dispose();
            }
            for (const n of dn.nodes) {
                try {
                    n.disconnect();
                } catch {
                    // Intentionally empty: a node already detached from the graph
                    // throws on disconnect() during teardown; safe to ignore.
                }
            }
        }
        this.strip.deviceNodes = [];
    }
}
