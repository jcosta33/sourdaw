import type { TrackChannelStrip, BuiltinDeviceNode, SendNode } from '../models/AudioEngineState';
import {
    isNativeDspDevice,
    NATIVE_DSP_DEVICE_TYPES,
    createNativeDspNode,
    type NativeDspNodeResult,
} from './NativeDspNode';
import { isDeviceSupportedOnCurrentPlatform } from '#/modules/Arrangement/useCases/trackQueries';
import { DEVICE_FACTORIES, applyParams } from '../repositories/deviceNodeFactory';
import { PluginHostNode } from '../models/PluginHostNode';
import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';

const logger = Container.getInstance().get(Logger);

export interface TrackNodeDeps {
    context: BaseAudioContext;
    masterGainNode: GainNode;
    getBusGainNode: (busId: string) => GainNode | undefined;
    getTrackGainNode: (trackId: string) => GainNode | undefined;
    getSendsForTrack: (trackId: string) => SendNode[];
    pendingFaustParams: Map<string, Map<string, number>>;
    pendingDevicePromises: Set<Promise<any>>;
}

export class TrackNode {
    public strip: TrackChannelStrip;

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

        gainNode.connect(preFaderTap);
        preFaderTap.connect(faderNode);
        faderNode.connect(postFaderGain);
        postFaderGain.connect(panNode);
        panNode.connect(analyserNode);

        this.strip = {
            trackId,
            preFaderTap,
            gainNode,
            faderNode,
            postFaderGain,
            panNode,
            analyserNode,
            muted: false,
            soloed: false,
            deviceNodes: [],
            meterBuffer: new Float32Array(analyserNode.frequencyBinCount),
        };

        this.routeOutput();
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
        const data = this.strip.meterBuffer;
        this.strip.analyserNode.getFloatTimeDomainData(data as any);
        let peak = 0;
        for (let i = 0; i < data.length; i++) {
            const abs = Math.abs(data[i]!);
            if (abs > peak) {
                peak = abs;
            }
        }
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

    public rebuildChain(): void {
        const s = this.strip;
        s.preFaderTap.disconnect();
        s.gainNode.disconnect();
        s.faderNode.disconnect();
        s.postFaderGain.disconnect();
        s.panNode.disconnect();
        s.analyserNode.disconnect();

        for (const dn of s.deviceNodes) {
            try {
                dn.outputNode.disconnect();
            } catch {
                /* ok */
            }
        }

        let prev: AudioNode = s.gainNode;
        for (const dn of s.deviceNodes) {
            if ((dn as any)._bypassed) {
                continue;
            }
            if (dn.inputNode.numberOfInputs > 0) {
                prev.connect(dn.inputNode);
            }
            prev = dn.outputNode;
        }

        prev.connect(s.preFaderTap);
        s.preFaderTap.connect(s.faderNode);
        s.faderNode.connect(s.postFaderGain);
        s.postFaderGain.connect(s.panNode);
        s.panNode.connect(s.analyserNode);

        this.routeOutput();
        this.reconnectSends();
    }

    public addDevice(deviceId: string, deviceType: string, externalInstanceId?: string): void {
        if (this.strip.deviceNodes.some((d) => d.deviceId === deviceId)) {
            return;
        }

        if (!isDeviceSupportedOnCurrentPlatform(deviceType)) {
            logger.info(`[WebAudioEngine] Skipping ${deviceType} — not supported`);
            return;
        }

        const { context, pendingFaustParams, pendingDevicePromises } = this.deps;
        let dn: BuiltinDeviceNode;

        if (deviceType === 'builtin-sidechain-compressor') {
            const workletNode = new AudioWorkletNode(context, 'sidechain-compressor-processor', {
                numberOfInputs: 2,
                numberOfOutputs: 1,
                outputChannelCount: [2],
            });
            dn = { deviceId, type: deviceType, nodes: [workletNode], inputNode: workletNode, outputNode: workletNode };
        } else if (deviceType === 'external-plugin') {
            const workletNode = new PluginHostNode(context as AudioContext, externalInstanceId ?? deviceId);
            dn = { deviceId, type: deviceType, nodes: [workletNode], inputNode: workletNode, outputNode: workletNode };
        } else if (deviceType.startsWith('faust-')) {
            const loadingBypassNode = context.createGain();
            dn = {
                deviceId,
                type: deviceType,
                nodes: [loadingBypassNode],
                inputNode: loadingBypassNode,
                outputNode: loadingBypassNode,
            };

            const loadPromise = import('../repositories/faustDeviceFactory')
                .then(({ createFaustDevice }) => {
                    return createFaustDevice(context, deviceType).then((realDn) => {
                        if (!realDn) {
                            return;
                        }
                        const idx = this.strip.deviceNodes.findIndex((d) => d.deviceId === deviceId);
                        if (idx !== -1) {
                            const builtinDn = realDn as BuiltinDeviceNode;
                            builtinDn.deviceId = deviceId;
                            builtinDn.type = deviceType;
                            this.strip.deviceNodes[idx] = builtinDn;
                            this.rebuildChain();

                            const pending = pendingFaustParams.get(deviceId);
                            if (pending) {
                                const worklet = builtinDn.nodes[0] as AudioWorkletNode;
                                for (const [pId, val] of pending) {
                                    const param = worklet.parameters.get(pId);
                                    if (param) {
                                        param.setTargetAtTime(val, context.currentTime, 0.01);
                                    }
                                }
                                pendingFaustParams.delete(deviceId);
                            }
                        }
                    });
                })
                .catch((error) => logger.warn(`[WebAudioEngine] Faust error: ${error}`));
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
                };
            } else if (isNativeDspDevice(deviceType)) {
                const pluginType = NATIVE_DSP_DEVICE_TYPES[deviceType];
                if (!pluginType) {
                    return;
                }
                const loadingBypass = context.createGain();
                dn = {
                    deviceId,
                    type: deviceType,
                    nodes: [loadingBypass],
                    inputNode: loadingBypass,
                    outputNode: loadingBypass,
                };

                const loadPromise = createNativeDspNode(context as AudioContext, pluginType)
                    .then(async (result: NativeDspNodeResult) => {
                        await result.ready;
                        const idx = this.strip.deviceNodes.findIndex((d) => d.deviceId === deviceId);
                        if (idx !== -1) {
                            const nativeDn: BuiltinDeviceNode = {
                                deviceId,
                                type: deviceType,
                                nodes: [result.workletNode],
                                inputNode: result.workletNode,
                                outputNode: result.workletNode,
                                nativeDspControls: result,
                            };
                            this.strip.deviceNodes[idx] = nativeDn;
                            this.rebuildChain();
                        }
                    })
                    .catch((error) => logger.warn(`[WebAudioEngine] Native DSP failed: ${error}`));
                pendingDevicePromises.add(loadPromise);
                loadPromise.finally(() => pendingDevicePromises.delete(loadPromise));
            } else {
                return;
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
        for (const n of dn.nodes) {
            n.disconnect();
        }
        this.strip.deviceNodes = this.strip.deviceNodes.filter((d) => d.deviceId !== deviceId);
        this.deps.pendingFaustParams.delete(deviceId);
        this.rebuildChain();
    }

    public updateParam(deviceId: string, paramId: string, value: number): void {
        const dn = this.strip.deviceNodes.find((d) => d.deviceId === deviceId);
        if (!dn) {
            return;
        }

        if (dn.type.startsWith('faust-')) {
            if (dn.nodes.length === 1 && dn.nodes[0] instanceof GainNode) {
                let map = this.deps.pendingFaustParams.get(deviceId);
                if (!map) {
                    map = new Map();
                    this.deps.pendingFaustParams.set(deviceId, map);
                }
                map.set(paramId, value);
                return;
            }
            const worklet = dn.nodes[0] as AudioWorkletNode;
            const param = worklet.parameters.get(paramId);
            if (param) {
                param.setTargetAtTime(value, this.deps.context.currentTime, 0.01);
            }
            return;
        }

        if (dn.type === 'builtin-sidechain-compressor') {
            const worklet = dn.nodes[0] as AudioWorkletNode;
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

        if (dn.type.startsWith('native-') && dn.nativeDspControls) {
            dn.nativeDspControls.setParam(paramId, value);
        } else if (DEVICE_FACTORIES[dn.type]) {
            applyParams(dn as any, dn.type, { [paramId]: value });
        }
    }

    public scheduleParam(deviceId: string, paramId: string, value: number, time: number): void {
        const dn = this.strip.deviceNodes.find((d) => d.deviceId === deviceId);
        if (!dn) {
            return;
        }
        if (dn.type.startsWith('faust-')) {
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
        }
    }

    public updateBypass(deviceId: string, bypassed: boolean): void {
        const dn = this.strip.deviceNodes.find((d) => d.deviceId === deviceId);
        if (!dn) {
            return;
        }
        if (dn.nativeDspControls) {
            dn.nativeDspControls.setBypass(bypassed);
        } else {
            (dn as any)._bypassed = bypassed;
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
            for (const n of dn.nodes) {
                n.disconnect();
            }
        }
    }
}
