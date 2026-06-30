import { logger } from '#/infra/logger/appLogger';
import { hasSharedArrayBuffer } from '#/utils/capabilities';

import { applyParams } from '../useCases/deviceResolvers/applyParams';
import { createBuiltinDeviceNode } from '../useCases/deviceResolvers/createBuiltinDeviceNode';

import { createNativePluginBridgeNode } from './NativePluginBridgeNode';
import { findWasmDescriptor } from './wasmDeviceRegistry';

import type { TrackChannelStrip, BuiltinDeviceNode, SendNode } from '../models/AudioEngineState';

export type TrackNodeDeps = {
    context: AudioContext;
    masterGainNode: GainNode;
    getBusGainNode: (id: string) => GainNode | undefined;
    getTrackGainNode: (id: string) => GainNode | undefined;
    getSendsForTrack: (tId: string) => SendNode[];
    pendingDevicePromises: Set<Promise<unknown>>;
    transportSAB?: SharedArrayBuffer;
    /** Adjustment-layer insert: when non-null for this track, `analyserNode`
     *  routes to this node instead of the track's default destination. */
    getAdjustmentBusForTrack?: (trackId: string) => AudioNode | null;
};

export class TrackNode {
    public strip: TrackChannelStrip;
    /** When SAB is unavailable, getPeakLevel falls back to AnalyserNode time-domain data. */
    private _analyserFallbackBuffer: Float32Array<ArrayBuffer> | null = null;
    // §88.3 — async plugin loads each resolve with a rebuildChain() call;
    // firing multiple of these in the same microtask produced overlapping
    // disconnect/reconnect sweeps. `_rebuildScheduled` coalesces them so at
    // most one rebuild runs per microtask turn.
    private _rebuildScheduled = false;

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
        this.strip.faderNode.gain.setTargetAtTime(Math.max(0, Math.min(1, gain)), this.deps.context.currentTime, 0.01);
    }

    public setPan(pan: number): void {
        this.strip.panNode.pan.setTargetAtTime(
            Math.max(-1, Math.min(1, pan / 50)),
            this.deps.context.currentTime,
            0.01
        );
    }

    public setMute(muted: boolean): void {
        this.strip.muted = muted;
        this.strip.postFaderGain.gain.setTargetAtTime(muted ? 0 : 1, this.deps.context.currentTime, 0.005);
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
        const peak = this.strip.meterBuffer[0]!;
        this.strip.meterBuffer[0] = 0;
        return peak;
    }

    public setOutput(outputId: string): void {
        this.strip.outputId = outputId;
        this.routeOutput();
    }

    public getDefaultDestination(): AudioNode {
        const { outputId } = this.strip;
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

        analyserNode.disconnect();

        const adjustmentBus = getAdjustmentBusForTrack?.(this.trackId) ?? null;
        if (adjustmentBus) {
            analyserNode.connect(adjustmentBus);
            return;
        }

        analyserNode.connect(this.getDefaultDestination());
    }

    private reconnectSends(): void {
        const sends = this.deps.getSendsForTrack(this.trackId);
        for (const send of sends) {
            try {
                send.gainNode.disconnect();
            } catch {
                /* already disconnected */
            }
            const tap = send.preFader ? this.strip.preFaderTap : this.strip.analyserNode;
            tap.connect(send.gainNode);

            const busGain = this.deps.getBusGainNode(send.busId);
            if (busGain) {
                send.gainNode.connect(busGain);
            }
        }
    }

    /** Coalesce concurrent rebuild requests into a single microtask (§88.3). */
    public scheduleRebuildChain(): void {
        if (this._rebuildScheduled) {
            return;
        }
        this._rebuildScheduled = true;
        queueMicrotask(() => {
            this._rebuildScheduled = false;
            this.rebuildChain();
        });
    }

    public rebuildChain(): void {
        const s = this.strip;
        s.preFaderTap.disconnect();
        s.gainNode.disconnect();
        s.faderNode.disconnect();
        s.postFaderGain.disconnect();
        s.panNode.disconnect();
        s.meterNode?.disconnect();
        s.analyserNode.disconnect();

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
            if (dn.inputNode.numberOfInputs > 0) {
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
        this.reconnectSends();
    }

    public addDevice(deviceId: string, deviceType: string, externalInstanceId?: string): void {
        if (this.strip.deviceNodes.some((d) => d.deviceId === deviceId)) {
            logger.debug(`Device ${deviceId} already exists on track ${this.trackId}`);
            return;
        }

        const { context, pendingDevicePromises } = this.deps;
        let dn: BuiltinDeviceNode;

        if (deviceType === 'builtin-sidechain-compressor') {
            const workletNode = new AudioWorkletNode(context, 'sidechain-compressor-processor', {
                numberOfInputs: 2,
                numberOfOutputs: 1,
                outputChannelCount: [2],
            });
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
            // Native plugin bridge: uses SharedArrayBuffer for zero-copy audio transfer
            // between Web Audio and the Rust cpal audio thread.
            const loadingBypass = context.createGain();
            dn = {
                deviceId,
                type: deviceType,
                nodes: [loadingBypass],
                inputNode: loadingBypass,
                outputNode: loadingBypass,
            };

            const pendingParams: Array<[string, number]> = [];
            const loadingControls = {
                setParam: (name: string, value: number) => {
                    pendingParams.push([name, value]);
                },
                setBypass: () => {},
                destroy: () => {},
            };
            dn.nativeDspControls = loadingControls;
            dn.controller = loadingControls;

            const loadPromise = createNativePluginBridgeNode(
                context,
                externalInstanceId ?? deviceId,
                0 // engine plugin ID — will be assigned by Rust
            )
                .then((result) => {
                    const idx = this.strip.deviceNodes.findIndex((d) => d.deviceId === deviceId);
                    if (idx !== -1) {
                        const controls = {
                            setParam: (name: string, value: number) => result.setParam(parseInt(name, 10) || 0, value),
                            setBypass: result.setBypass,
                            destroy: () => result.workletNode.disconnect(),
                        };
                        // Replay parameter values buffered against the loading
                        // placeholder (e.g. saved Track.devices[*].parameterValues
                        // applied during live reload before the bridge resolved).
                        // Mirrors the wasm descriptors and the offline
                        // NativeDspDeviceStrategy, which both drain their pending
                        // params on load — without this the bridge stays at engine
                        // defaults while the offline render reflects saved knobs.
                        for (const [name, value] of pendingParams) {
                            controls.setParam(name, value);
                        }
                        const bridgeDn: BuiltinDeviceNode = {
                            deviceId,
                            type: deviceType,
                            nodes: [result.workletNode],
                            inputNode: result.workletNode,
                            outputNode: result.workletNode,
                            nativeDspControls: controls,
                            controller: controls,
                        };
                        this.strip.deviceNodes[idx] = bridgeDn;
                        this.scheduleRebuildChain();
                    }
                })
                .catch((error) => logger.warn(`[WebAudioEngine] Native plugin bridge failed: ${error}`));
            pendingDevicePromises.add(loadPromise);
            // Fire-and-forget cleanup: `loadPromise` already has its own .catch()
            // (above); this .finally() only removes the entry from the tracking
            // Set once settled and never rejects meaningfully.
            void loadPromise.finally(() => pendingDevicePromises.delete(loadPromise));
        } else {
            const factoryNode = createBuiltinDeviceNode({ context, deviceType });
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
                const descriptor = findWasmDescriptor(deviceType);
                if (!descriptor) {
                    return;
                }
                const { placeholder, loadPromise } = descriptor.create({
                    context,
                    deviceId,
                    deviceType,
                    transportSAB: this.deps.transportSAB,
                    onLoaded: (finalDn) => {
                        const idx = this.strip.deviceNodes.findIndex((d) => d.deviceId === deviceId);
                        if (idx !== -1) {
                            this.strip.deviceNodes[idx] = finalDn;
                            this.scheduleRebuildChain();
                        }
                    },
                });
                dn = placeholder;
                pendingDevicePromises.add(loadPromise);
                // Fire-and-forget cleanup: the descriptor's `loadPromise` already
                // has its own .catch() (see wasmDeviceRegistry); this .finally()
                // only removes the entry from the tracking Set once settled.
                void loadPromise.finally(() => pendingDevicePromises.delete(loadPromise));
            }
        }

        this.strip.deviceNodes.push(dn);
        this.rebuildChain();
    }

    public removeDevice(deviceId: string): void {
        const dn = this.strip.deviceNodes.find((d) => d.deviceId === deviceId);
        if (!dn) {
            return;
        }

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
                // throws on disconnect(); nothing to clean up in that case.
            }
        }
        this.strip.deviceNodes = this.strip.deviceNodes.filter((d) => d.deviceId !== deviceId);
        this.rebuildChain();
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

    public updateBypass(deviceId: string, bypassed: boolean): void {
        const dn = this.strip.deviceNodes.find((d) => d.deviceId === deviceId);
        if (!dn) {
            return;
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
        if (dn.bypassed !== bypassed) {
            dn.bypassed = bypassed;
            this.scheduleRebuildChain();
        }
    }

    public dispose(): void {
        this.strip.preFaderTap.disconnect();
        this.strip.gainNode.disconnect();
        this.strip.faderNode.disconnect();
        this.strip.postFaderGain.disconnect();
        this.strip.panNode.disconnect();
        this.strip.analyserNode.disconnect();
        if (this.strip.meterNode) {
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
    }
}
