import { type OfflineDeviceNode } from '../types';
import { IR_GENERATORS } from './helpers';

export const IR_NAMES = Object.keys(IR_GENERATORS);

export function applyConvolutionReverbParams(dn: OfflineDeviceNode, params: Record<string, number>): void {
    const dryConv = dn.nodes[1] as GainNode;
    const wetConv = dn.nodes[2] as GainNode;
    const convolverNode = dn.nodes[3] as ConvolverNode;
    const predelayConv = dn.nodes[5] as DelayNode;
    const lowcutConv = dn.nodes[6] as BiquadFilterNode;
    const highcutConv = dn.nodes[7] as BiquadFilterNode;
    if (params['conv-mix'] !== undefined) {
        wetConv.gain.value = params['conv-mix'];
        dryConv.gain.value = 1 - params['conv-mix'];
    }
    if (params['conv-predelay'] !== undefined) {
        predelayConv.delayTime.value = params['conv-predelay'] / 1000;
    }
    if (params['conv-lowcut'] !== undefined) {
        lowcutConv.frequency.value = params['conv-lowcut'];
    }
    if (params['conv-highcut'] !== undefined) {
        highcutConv.frequency.value = params['conv-highcut'];
    }
    if (params['conv-ir'] !== undefined) {
        const irIndex = Math.round(params['conv-ir']);
        const irName = IR_NAMES[irIndex] ?? 'studio-a';
        const gen = IR_GENERATORS[irName];
        if (gen && convolverNode.context) {
            convolverNode.buffer = gen(convolverNode.context.sampleRate);
        }
    }
}