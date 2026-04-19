import type { TrackChannelStrip, BuiltinDeviceNode, SendNode } from '../models/AudioEngineState';
import { unregisterLevainDevice } from '#/modules/Levain/useCases';
import { unregisterProofDevice } from '#/modules/Proof/useCases';
import { DEVICE_FACTORIES } from '../useCases/deviceResolvers/helpers';
import { applyParams } from '../useCases/deviceResolvers/applyParams';
import { findWasmDescriptor } from './wasmDeviceRegistry';
import { createNativePluginBridgeNode } from './NativePluginBridgeNode';
import { hasSharedArrayBuffer } from '#/utils/capabilities';
import { logger } from '#/infra/logger/appLogger';

export type TrackNodeDeps = {
    context: AudioContext;
    masterGainNode: GainNode;
    getBusGainNode: (id: string) => GainNode | undefined;
    getTrackGainNode: (id: string) => GainNode | undefined;
    getSendsForTrack: (tId: string) => SendNode[];
    pendingDevicePromises: Set<Promise<any>>;
    transportSAB?: SharedArrayBuffer;
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
            const meterSab = new SharedArrayBuffer(4);
            meterNode = new AudioWorkletNode(context, 'metering-processor');
            meterNode.port.postMessage({ type: 'init', sab: meterSab, channels: 2 });
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
        const nativeDevice = this.strip.deviceNodes.find(d => d.type === 'external-plugin');
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
            if (dn.kneadControls) {
                dn.kneadControls.setParam('tuning-table', frequencies as any);
            }
            if (dn.fermenterControls) {
                dn.fermenterControls.setParam('tuning-table', frequencies as any);
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
                if (abs > peak) peak = abs;
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

    private routeOutput(): void {
        const { analyserNode, outputId } = this.strip;
        const { masterGainNode, getBusGainNode, getTrackGainNode } = this.deps;

        analyserNode.disconnect();

        if (outputId === 'hw_out' || !outputId) {
            analyserNode.connect(masterGainNode);
        } else {
            const target = getBusGainNode(outputId) || getTrackGainNode(outputId);
            if (target) {
                analyserNode.connect(target);
            } else {
                analyserNode.connect(masterGainNode);
            }
        }
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
            dn.nativeDspControls = {
                setParam: (name: string, value: number) => {
                    pendingParams.push([name, value]);
                },
                setBypass: () => {},
            };

            const loadPromise = createNativePluginBridgeNode(
                context as AudioContext,
                externalInstanceId ?? deviceId,
                0 // engine plugin ID — will be assigned by Rust
            )
                .then((result) => {
                    const idx = this.strip.deviceNodes.findIndex((d) => d.deviceId === deviceId);
                    if (idx !== -1) {
                        const bridgeDn: BuiltinDeviceNode = {
                            deviceId,
                            type: deviceType,
                            nodes: [result.workletNode],
                            inputNode: result.workletNode,
                            outputNode: result.workletNode,
                            nativeDspControls: {
                                setParam: (name: string, value: number) =>
                                    result.setParam(parseInt(name, 10) || 0, value),
                                setBypass: result.setBypass,
                            },
                        };
                        this.strip.deviceNodes[idx] = bridgeDn;
                        this.scheduleRebuildChain();
                    }
                })
                .catch((error) => logger.warn(`[WebAudioEngine] Native plugin bridge failed: ${error}`));
            pendingDevicePromises.add(loadPromise);
            loadPromise.finally(() => pendingDevicePromises.delete(loadPromise));
        } else {
            const factory = DEVICE_FACTORIES[deviceType];
            if (factory) {
                const factoryNode = factory(context);
                dn = {
                    deviceId,
                    type: deviceType,
                    nodes: factoryNode.nodes,
                    inputNode: factoryNode.inputNode,
                    outputNode: factoryNode.outputNode,
                    dispose: factoryNode.dispose,
                };
            } else {
                const descriptor = findWasmDescriptor(deviceType);
                if (!descriptor) {
                    return;
                }
                const { placeholder, loadPromise } = descriptor.create({
                    context: context as AudioContext,
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
                loadPromise.finally(() => pendingDevicePromises.delete(loadPromise));
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
        if (dn.dispose) {
            dn.dispose();
        }
        if (dn.fermenterControls) {
            dn.fermenterControls.destroy();
        }
        if (dn.toasterControls) {
            dn.toasterControls.destroy();
        }
        if (dn.levainControls) {
            dn.levainControls.destroy();
        }
        if (dn.grandBouleControls) {
            dn.grandBouleControls.destroy();
        }
        if (dn.wamControls) {
            dn.wamControls.destroy?.();
        }
        if (dn.type === 'proof') {
            unregisterProofDevice(deviceId);
        }
        for (const n of dn.nodes) {
            n.disconnect();
        }
        this.strip.deviceNodes = this.strip.deviceNodes.filter((d) => d.deviceId !== deviceId);
        this.rebuildChain();
    }

    public updateParam(deviceId: string, paramId: string, value: number): void {
        const dn = this.strip.deviceNodes.find((d) => d.deviceId === deviceId);
        if (!dn) {
            return;
        }

        if (dn.wamControls) {
            dn.wamControls.setParam(paramId, value);
            return;
        }

        if (dn.type === 'builtin-sidechain-compressor') {
            const worklet = dn.nodes[0];
            if (!(worklet instanceof AudioWorkletNode)) {
                return;
            }
            const param = worklet.parameters.get(paramId.replace('sc-comp-', ''));
            if (param) {
                if (paramId === 'sc-comp-attack' || paramId === 'sc-comp-release') {
                    param.setTargetAtTime(value / 1000, this.deps.context.currentTime, 0.01);
                } else {
                    param.setTargetAtTime(value, this.deps.context.currentTime, 0.01);
                }
            }
            return;
        }

        if (dn.fermenterControls) {
            dn.fermenterControls.setParam(paramId, value);
            return;
        }

        if (dn.toasterControls) {
            dn.toasterControls.setParam(paramId, value);
            return;
        }

        if (dn.levainControls) {
            dn.levainControls.setParam(paramId, value);
            return;
        }

        if (dn.nativeDspControls) {
            dn.nativeDspControls.setParam(paramId, value);
        } else if (DEVICE_FACTORIES[dn.type]) {
            applyParams(dn as any, dn.type, { [paramId]: value });
        }
    }

    public updatePatch(deviceId: string, patch: Record<string, unknown>): void {
        const dn = this.strip.deviceNodes.find((d) => d.deviceId === deviceId);
        if (!dn) return;

        if (dn.fermenterControls) {
            dn.fermenterControls.setPatch?.(patch);
        }
    }

    public scheduleParam(deviceId: string, paramId: string, value: number, time: number): void {
        const dn = this.strip.deviceNodes.find((d) => d.deviceId === deviceId);
        if (!dn) {
            return;
        }
        if (dn.wamControls) {
            dn.wamControls.scheduleParam(paramId, value, time);
        } else if (dn.type.startsWith('faust-')) {
            const worklet = dn.nodes[0];
            if (worklet && worklet instanceof AudioWorkletNode) {
                let targetParam: AudioParam | null = null;
                const exact = worklet.parameters.get(paramId);
                if (exact) {
                    targetParam = exact;
                } else {
                    for (const [key, param] of worklet.parameters) {
                        if (key.endsWith(`/${paramId}`)) {
                            targetParam = param;
                            break;
                        }
                    }
                }
                if (targetParam) {
                    targetParam.setValueAtTime(value, time);
                }
            }
        } else if (dn.fermenterControls) {
            const sampleFrame = Math.round(time * this.deps.context.sampleRate);
            dn.fermenterControls.setParam(paramId, value, sampleFrame);
        }
    }

    public updateBypass(deviceId: string, bypassed: boolean): void {
        const dn = this.strip.deviceNodes.find((d) => d.deviceId === deviceId);
        if (!dn) {
            return;
        }
        if (dn.fermenterControls) {
            dn.fermenterControls.setBypass(bypassed);
        } else if (dn.toasterControls) {
            dn.toasterControls.setBypass(bypassed);
        } else if (dn.levainControls) {
            dn.levainControls.setBypass(bypassed);
        } else if (dn.nativeDspControls) {
            dn.nativeDspControls.setBypass(bypassed);
        } else {
            dn.bypassed = bypassed;
            this.rebuildChain();
        }
    }

    public dispose(): void {
        this.strip.preFaderTap.disconnect();
        this.strip.gainNode.disconnect();
        this.strip.faderNode.disconnect();
        this.strip.postFaderGain.disconnect();
        this.strip.panNode.disconnect();
        this.strip.analyserNode.disconnect();
        for (const dn of this.strip.deviceNodes) {
            if (dn.dispose) {
                dn.dispose();
            }
            if (dn.fermenterControls) {
                dn.fermenterControls.destroy();
            }
            if (dn.toasterControls) {
                dn.toasterControls.destroy();
            }
            if (dn.levainControls) {
                dn.levainControls.destroy();
                unregisterLevainDevice();
            }
            if (dn.wamControls) {
                dn.wamControls.destroy?.();
            }
            for (const n of dn.nodes) {
                n.disconnect();
            }
        }
    }
}
