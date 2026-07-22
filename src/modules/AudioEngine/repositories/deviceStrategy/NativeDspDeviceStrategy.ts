import { isBacteriaDevice, createBacteriaNode } from '../../engine/BacteriaNode';
import { isFermenterDevice, createFermenterNode } from '../../engine/FermenterNode';
import { isGlutenDevice, createGlutenNode } from '../../engine/GlutenNode';
import { isGrandBouleDevice, createGrandBouleNode } from '../../engine/GrandBouleNode';
import { isGrinderDevice, createGrinderNode } from '../../engine/GrinderNode';
import { isKneadDevice, createKneadNode } from '../../engine/KneadNode';
import { isLevainDevice, createLevainNode } from '../../engine/LevainNode';
import { isProofChamberDevice, createProofChamberNode } from '../../engine/ProofChamberNode';
import { isProofDevice, createProofNode } from '../../engine/ProofNode';
import { isScoringDevice, createScoringNode } from '../../engine/ScoringNode';
import { isToasterDevice, createToasterNode } from '../../engine/ToasterNode';
import { type Device } from '../../models/TrackViewTypes';
import { type OfflineDeviceNode } from '../devices/types';

import { type AudioDeviceStrategy } from './AudioDeviceStrategy';

type NativeDspNode = {
    workletNode: AudioWorkletNode;
    setParam?: (name: string, value: number) => void;
    setBypass?: (bypassed: boolean) => void;
    noteOn?: (noteOrPad: number, velocity: number, midiNote?: number, sampleFrame?: number) => void;
    noteOff?: (noteOrPad: number, sampleFrame?: number) => void;
    connectPadOutput?: (pad: number, destination: AudioNode) => void;
    disconnectPadOutput?: (pad: number, destination: AudioNode) => void;
    setPadDryRouted?: (pad: number, routed: boolean) => void;
    destroy?: () => void;
    ready: Promise<Record<string, unknown>>;
};

export class NativeDspDeviceStrategy implements AudioDeviceStrategy {
    public readonly node: OfflineDeviceNode;

    constructor(private readonly dspNode: NativeDspNode) {
        this.node = {
            inputNode: dspNode.workletNode,
            outputNode: dspNode.workletNode,
            nodes: [dspNode.workletNode],
        };
    }

    setParam(name: string, value: number): void {
        this.dspNode.setParam?.(name, value);
    }

    setBypass(bypassed: boolean): void {
        this.dspNode.setBypass?.(bypassed);
    }

    noteOn(noteOrPad: number, velocity: number, midiNote?: number, sampleFrame?: number): void {
        this.dspNode.noteOn?.(noteOrPad, velocity, midiNote, sampleFrame);
    }

    noteOff(noteOrPad: number, sampleFrame?: number): void {
        this.dspNode.noteOff?.(noteOrPad, sampleFrame);
    }

    connectPadOutput(pad: number, destination: AudioNode): void {
        this.dspNode.connectPadOutput?.(pad, destination);
    }

    disconnectPadOutput(pad: number, destination: AudioNode): void {
        this.dspNode.disconnectPadOutput?.(pad, destination);
    }

    setPadDryRouted(pad: number, routed: boolean): void {
        this.dspNode.setPadDryRouted?.(pad, routed);
    }

    destroy(): void {
        this.dspNode.destroy?.();
    }
}

export async function createNativeDspStrategy(ctx: BaseAudioContext, device: Device): Promise<NativeDspDeviceStrategy> {
    let result: NativeDspNode | null = null;

    if (isFermenterDevice(device.type)) {
        result = await createFermenterNode(ctx);
    } else if (isToasterDevice(device.type)) {
        result = await createToasterNode(ctx);
    } else if (isLevainDevice(device.type)) {
        result = await createLevainNode(ctx);
    } else if (isGlutenDevice(device.type)) {
        result = await createGlutenNode(ctx);
    } else if (isBacteriaDevice(device.type)) {
        result = await createBacteriaNode(ctx);
    } else if (isGrinderDevice(device.type)) {
        result = await createGrinderNode(ctx);
    } else if (isProofDevice(device.type)) {
        result = await createProofNode(ctx);
    } else if (isProofChamberDevice(device.type)) {
        result = await createProofChamberNode(ctx);
    } else if (isScoringDevice(device.type)) {
        result = await createScoringNode(ctx);
    } else if (isGrandBouleDevice(device.type)) {
        result = await createGrandBouleNode(ctx);
    } else if (isKneadDevice(device.type)) {
        result = await createKneadNode(ctx);
    }

    if (!result) {
        throw new Error(`Failed to create Native DSP device: ${device.type}`);
    }

    await result.ready;

    const strategy = new NativeDspDeviceStrategy(result);
    for (const [key, val] of Object.entries(device.parameterValues)) {
        strategy.setParam(key, val);
    }

    return strategy;
}
