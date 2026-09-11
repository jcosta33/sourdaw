import { type OfflineDeviceNode } from '../types';

import { applyReverbImpulseShape } from './reverbImpulse';

export function applyReverbParams(dn: OfflineDeviceNode, params: Record<string, number>): void {
    const nn = dn.namedNodes;
    const dry = (nn?.dry ?? dn.nodes[1]) as GainNode;
    const wet = (nn?.wet ?? dn.nodes[2]) as GainNode;
    const predelay = (nn?.predelay ?? dn.nodes[5]) as DelayNode;
    const lowcut = (nn?.lowcut ?? dn.nodes[6]) as BiquadFilterNode;
    // Absent shape keys merge with the installed impulse inside the applier.
    applyReverbImpulseShape(dn, undefined, {
        size: params['rev-size'],
        decay: params['rev-decay'],
        damping: params['rev-damping'],
    });
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
