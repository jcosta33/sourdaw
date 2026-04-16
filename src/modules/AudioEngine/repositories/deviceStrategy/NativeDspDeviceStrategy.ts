import { type AudioDeviceStrategy } from './AudioDeviceStrategy';
import { type OfflineDeviceNode } from '../devices/types';
import { type Device } from '../../models/TrackViewTypes';

import { isFermenterDevice, createFermenterNode } from '../../engine/FermenterNode';
import { isToasterDevice, createToasterNode } from '../../engine/ToasterNode';
import { isLevainDevice, createLevainNode } from '../../engine/LevainNode';
import { isGlutenDevice, createGlutenNode } from '../../engine/GlutenNode';
import { isBacteriaDevice, createBacteriaNode } from '../../engine/BacteriaNode';
import { isGrinderDevice, createGrinderNode } from '../../engine/GrinderNode';
import { isProofDevice, createProofNode } from '../../engine/ProofNode';
import { isProofChamberDevice, createProofChamberNode } from '../../engine/ProofChamberNode';
import { isScoringDevice, createScoringNode } from '../../engine/ScoringNode';
import { isGrandBouleDevice, createGrandBouleNode } from '../../engine/GrandBouleNode';

export class NativeDspDeviceStrategy implements AudioDeviceStrategy {
    public readonly node: OfflineDeviceNode;

    constructor(private readonly dspNode: any) {
        this.node = {
            inputNode: dspNode.workletNode,
            outputNode: dspNode.workletNode,
            nodes: [dspNode.workletNode],
        };
    }

    setParam(name: string, value: number): void {
        if (typeof this.dspNode.setParam === 'function') {
            this.dspNode.setParam(name, value);
        }
    }

    setBypass(bypassed: boolean): void {
        if (typeof this.dspNode.setBypass === 'function') {
            this.dspNode.setBypass(bypassed);
        }
    }

    noteOn(noteOrPad: number, velocity: number, midiNote?: number, sampleFrame?: number): void {
        if (typeof this.dspNode.noteOn === 'function') {
            this.dspNode.noteOn(noteOrPad, velocity, midiNote, sampleFrame);
        }
    }

    noteOff(noteOrPad: number, sampleFrame?: number): void {
        if (typeof this.dspNode.noteOff === 'function') {
            this.dspNode.noteOff(noteOrPad, sampleFrame);
        }
    }

    destroy(): void {
        if (typeof this.dspNode.destroy === 'function') {
            this.dspNode.destroy();
        }
    }
}

export async function createNativeDspStrategy(ctx: BaseAudioContext, device: Device): Promise<NativeDspDeviceStrategy> {
    let result: any = null;

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
