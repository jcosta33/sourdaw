import { type AdjustmentEffectType } from '#/modules/Arrangement/stores';

import { applyParams } from '../useCases/deviceResolvers/applyParams';
import { createBuiltinDeviceNode } from '../useCases/deviceResolvers/createBuiltinDeviceNode';

import type { OfflineDeviceNode } from '../models/OfflineDeviceNode';

export type AdjustmentBusDeps = {
    context: BaseAudioContext;
    effectType: AdjustmentEffectType;
    parameters: Record<string, number>;
};

export type AdjustmentBusRuntimeResources = {
    effectType: AdjustmentEffectType;
    audioNodes: number;
    audioWorkletProcessors: number;
};

export const ADJUSTMENT_DEVICE_TYPE: Record<AdjustmentEffectType, string | null> = {
    eq: 'builtin-eq',
    compressor: 'builtin-compressor',
    reverb: 'builtin-reverb',
    delay: 'builtin-delay',
    saturation: 'builtin-distortion',
    filter: 'builtin-filter',
    'stereo-width': 'builtin-stereo-widener',
    volume: 'builtin-gain',
    pan: null,
};

export const ADJUSTMENT_PARAM_MAP: Record<AdjustmentEffectType, Record<string, string>> = {
    eq: {
        'Low Cut': 'eq-low-freq',
        'Low Gain': 'eq-low-gain',
        'Mid Gain': 'eq-mid-gain',
        'High Gain': 'eq-high-gain',
        'High Cut': 'eq-high-freq',
    },
    compressor: {
        Threshold: 'comp-threshold',
        Ratio: 'comp-ratio',
        Attack: 'comp-attack',
        Release: 'comp-release',
        Makeup: 'comp-makeup',
    },
    reverb: {
        Size: 'rev-mix',
        'Pre-Delay': 'rev-predelay',
        Damping: 'rev-lowcut',
        // NOTE: No `Decay` entry. The builtin reverb device (`applyReverbParams`)
        // has no `rev-decay` branch, so mapping the adjustment-layer Decay knob to
        // `rev-decay` would translate to a key that reaches no audio node — a
        // silent no-op. Adding real reverb decay is gated on Architecture-decision
        // #1 (whether the builtin reverb gets room-size/decay params); until then
        // the knob must not be wired here. See AdjustmentBusNode.spec.ts.
    },
    delay: {
        Time: 'delay-time',
        Feedback: 'delay-feedback',
    },
    saturation: {
        Drive: 'dist-drive',
        Tone: 'dist-tone',
    },
    filter: {
        Cutoff: 'filter-cutoff',
        Resonance: 'filter-resonance',
        Type: 'filter-type',
    },
    'stereo-width': {
        Width: 'width-amount',
        Center: 'width-mid',
    },
    volume: {
        Gain: 'gain-level',
    },
    pan: {},
};

function translateParams(effectType: AdjustmentEffectType, params: Record<string, number>): Record<string, number> {
    const map = ADJUSTMENT_PARAM_MAP[effectType];
    const translated: Record<string, number> = {};
    for (const [friendlyName, value] of Object.entries(params)) {
        const internalKey = map[friendlyName];
        if (internalKey !== undefined) {
            translated[internalKey] = convertParamValue(effectType, friendlyName, value);
        }
    }
    return translated;
}

function convertParamValue(effectType: AdjustmentEffectType, paramName: string, value: number): number {
    if (effectType === 'reverb' && paramName === 'Size') {
        return value / 100;
    }
    if (effectType === 'saturation' && paramName === 'Tone') {
        return 200 + (value / 100) * 19800;
    }
    if (effectType === 'stereo-width' && paramName === 'Width') {
        return value / 100;
    }
    return value;
}

export class AdjustmentBusNode {
    public readonly inputNode: GainNode;
    public readonly outputNode: GainNode;
    private readonly context: BaseAudioContext;
    private readonly effectType: AdjustmentEffectType;
    private readonly wetGain: GainNode;
    private readonly dryGain: GainNode;
    private readonly deviceNode: OfflineDeviceNode | null;
    private readonly panNode: StereoPannerNode | null;
    private disposed = false;
    private sources = new Set<AudioNode>();
    private destination: AudioNode | null = null;

    constructor(deps: AdjustmentBusDeps) {
        this.context = deps.context;
        this.effectType = deps.effectType;

        const ctx = this.context;
        this.inputNode = ctx.createGain();
        this.inputNode.gain.value = 1;
        this.outputNode = ctx.createGain();
        this.outputNode.gain.value = 1;

        this.dryGain = ctx.createGain();
        this.dryGain.gain.value = 0;
        this.wetGain = ctx.createGain();
        this.wetGain.gain.value = 0;

        this.inputNode.connect(this.dryGain);
        this.dryGain.connect(this.outputNode);

        const result = this.buildEffectChain(deps.parameters);
        this.deviceNode = result.deviceNode;
        this.panNode = result.panNode;
    }

    private buildEffectChain(parameters: Record<string, number>): {
        deviceNode: OfflineDeviceNode | null;
        panNode: StereoPannerNode | null;
    } {
        if (this.effectType === 'pan') {
            const pan = this.context.createStereoPanner();
            pan.pan.value = (parameters.Pan ?? 0) / 100;
            this.inputNode.connect(pan);
            pan.connect(this.wetGain);
            this.wetGain.connect(this.outputNode);
            return { deviceNode: null, panNode: pan };
        }

        const deviceType = ADJUSTMENT_DEVICE_TYPE[this.effectType];
        if (deviceType === null) {
            this.inputNode.connect(this.wetGain);
            this.wetGain.connect(this.outputNode);
            return { deviceNode: null, panNode: null };
        }

        const deviceNode = createBuiltinDeviceNode({ context: this.context, deviceType });
        if (!deviceNode) {
            this.inputNode.connect(this.wetGain);
            this.wetGain.connect(this.outputNode);
            return { deviceNode: null, panNode: null };
        }

        const translated = translateParams(this.effectType, parameters);
        applyParams(deviceNode, deviceType, translated);

        this.inputNode.connect(deviceNode.inputNode);
        deviceNode.outputNode.connect(this.wetGain);
        this.wetGain.connect(this.outputNode);

        return { deviceNode, panNode: null };
    }

    public connectSource(source: AudioNode): void {
        if (this.disposed) {
            return;
        }
        if (this.sources.has(source)) {
            return;
        }
        source.connect(this.inputNode);
        this.sources.add(source);
    }

    public disconnectSource(source: AudioNode): void {
        if (!this.sources.has(source)) {
            return;
        }
        try {
            source.disconnect(this.inputNode);
        } catch {
            // Intentionally empty: WebAudio throws if the edge was already
            // removed; the bookkeeping below still needs to run.
        }
        this.sources.delete(source);
    }

    public connectDestination(dest: AudioNode): void {
        if (this.disposed) {
            return;
        }
        if (this.destination === dest) {
            return;
        }
        if (this.destination) {
            try {
                this.outputNode.disconnect(this.destination);
            } catch {
                // Intentionally empty: detaching a stale destination edge throws
                // if it was already removed; we re-point to `dest` regardless.
            }
        }
        this.outputNode.connect(dest);
        this.destination = dest;
    }

    public disconnectDestination(): void {
        if (this.destination) {
            try {
                this.outputNode.disconnect(this.destination);
            } catch {
                // Intentionally empty: WebAudio throws if the destination edge
                // was already removed; clearing the reference below is enough.
            }
            this.destination = null;
        }
    }

    public setBlend(blend: number, timeConstant = 0.05): void {
        if (this.disposed) {
            return;
        }
        const clamped = Math.max(0, Math.min(1, blend));
        const now = this.context.currentTime;
        this.wetGain.gain.setTargetAtTime(clamped, now, timeConstant);
        this.dryGain.gain.setTargetAtTime(1 - clamped, now, timeConstant);
    }

    public setParams(parameters: Record<string, number>): void {
        if (this.disposed) {
            return;
        }
        if (this.effectType === 'pan' && this.panNode) {
            this.panNode.pan.setTargetAtTime((parameters.Pan ?? 0) / 100, this.context.currentTime, 0.01);
            return;
        }
        if (!this.deviceNode) {
            return;
        }
        const deviceType = ADJUSTMENT_DEVICE_TYPE[this.effectType];
        if (!deviceType) {
            return;
        }
        applyParams(this.deviceNode, deviceType, translateParams(this.effectType, parameters));
    }

    public hasSource(source: AudioNode): boolean {
        return this.sources.has(source);
    }

    public getRuntimeResources(): AdjustmentBusRuntimeResources {
        const ownedNodes = new Set<AudioNode>([this.inputNode, this.outputNode, this.dryGain, this.wetGain]);
        if (this.panNode) {
            ownedNodes.add(this.panNode);
        }
        if (this.deviceNode) {
            ownedNodes.add(this.deviceNode.inputNode);
            ownedNodes.add(this.deviceNode.outputNode);
            for (const node of this.deviceNode.nodes) {
                ownedNodes.add(node);
            }
        }

        let audioWorkletProcessors = 0;
        if (typeof AudioWorkletNode !== 'undefined') {
            for (const node of ownedNodes) {
                if (node instanceof AudioWorkletNode) {
                    audioWorkletProcessors++;
                }
            }
        }

        return {
            effectType: this.effectType,
            audioNodes: ownedNodes.size,
            audioWorkletProcessors,
        };
    }

    public dispose(): void {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        // Every disconnect() below is a teardown guard: WebAudio throws when an
        // edge was already removed (e.g. the node was detached elsewhere). The
        // empty catches are intentional — there is nothing to recover, and the
        // remaining teardown steps must still run.
        for (const src of this.sources) {
            try {
                src.disconnect(this.inputNode);
            } catch {
                // Intentionally empty: source edge may already be detached.
            }
        }
        this.sources.clear();
        if (this.destination) {
            try {
                this.outputNode.disconnect(this.destination);
            } catch {
                // Intentionally empty: destination edge may already be detached.
            }
            this.destination = null;
        }
        try {
            this.inputNode.disconnect();
        } catch {
            // Intentionally empty: input node may already be detached.
        }
        try {
            this.dryGain.disconnect();
        } catch {
            // Intentionally empty: dry-gain node may already be detached.
        }
        try {
            this.wetGain.disconnect();
        } catch {
            // Intentionally empty: wet-gain node may already be detached.
        }
        if (this.panNode) {
            try {
                this.panNode.disconnect();
            } catch {
                // Intentionally empty: pan node may already be detached.
            }
        }
        if (this.deviceNode) {
            try {
                this.deviceNode.inputNode.disconnect();
            } catch {
                // Intentionally empty: device input may already be detached.
            }
            try {
                this.deviceNode.outputNode.disconnect();
            } catch {
                // Intentionally empty: device output may already be detached.
            }
            for (const node of this.deviceNode.nodes) {
                try {
                    node.disconnect();
                } catch {
                    // Intentionally empty: internal device node may already be detached.
                }
            }
            this.deviceNode.dispose?.();
        }
    }
}
