import { type OfflineDeviceNode } from '../types';

export function applyDelayParams(dn: OfflineDeviceNode, params: Record<string, number>): void {
    const delay = dn.nodes[3] as DelayNode;
    const fb = dn.nodes[4] as GainNode;
    const dryD = dn.nodes[1] as GainNode;
    const wetD = dn.nodes[2] as GainNode;
    const fbLowcut = dn.nodes[6] as BiquadFilterNode;
    const fbHighcut = dn.nodes[7] as BiquadFilterNode;
    if (params['delay-time'] !== undefined) {
        delay.delayTime.value = params['delay-time'] / 1000;
    }
    if (params['delay-feedback'] !== undefined) {
        fb.gain.value = params['delay-feedback'];
    }
    if (params['delay-lowcut'] !== undefined) {
        fbLowcut.frequency.value = params['delay-lowcut'];
    }
    if (params['delay-highcut'] !== undefined) {
        fbHighcut.frequency.value = params['delay-highcut'];
    }
    if (params['delay-mix'] !== undefined) {
        wetD.gain.value = params['delay-mix'];
        dryD.gain.value = 1 - params['delay-mix'];
    }
}