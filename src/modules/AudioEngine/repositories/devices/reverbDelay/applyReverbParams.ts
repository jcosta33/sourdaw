import { type OfflineDeviceNode } from '../types';

export function applyReverbParams(dn: OfflineDeviceNode, params: Record<string, number>): void {
    const dry = dn.nodes[1] as GainNode;
    const wet = dn.nodes[2] as GainNode;
    const predelay = dn.nodes[5] as DelayNode;
    const lowcut = dn.nodes[6] as BiquadFilterNode;
    if (params['rev-mix'] !== undefined) {
        wet.gain.value = params['rev-mix'];
        dry.gain.value = 1 - params['rev-mix'];
    }
    if (params['rev-predelay'] !== undefined) {
        predelay.delayTime.value = params['rev-predelay'] / 1000;
    }
    if (params['rev-lowcut'] !== undefined) {
        lowcut.frequency.value = params['rev-lowcut'];
    }
}