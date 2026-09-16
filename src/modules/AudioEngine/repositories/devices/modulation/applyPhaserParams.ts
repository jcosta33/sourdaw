import { type OfflineDeviceNode } from '../types';

import { wirePhaserStages } from './phaserWiring';

export function applyPhaserParams(dn: OfflineDeviceNode, params: Record<string, number>): void {
    const nn = dn.namedNodes;
    const lfoP = (nn?.lfo ?? dn.nodes[15]) as OscillatorNode;
    const lfoGainP = (nn?.lfoGain ?? dn.nodes[16]) as GainNode;
    const feedbackP = (nn?.feedback ?? dn.nodes[17]) as GainNode;
    const dryP = (nn?.dry ?? dn.nodes[1]) as GainNode;
    const wetP = (nn?.wet ?? dn.nodes[2]) as GainNode;
    if (params['phaser-rate'] !== undefined) {
        lfoP.frequency.value = params['phaser-rate'];
    }
    if (params['phaser-depth'] !== undefined) {
        lfoGainP.gain.value = params['phaser-depth'] * 1000;
        const wetVal = params['phaser-depth'] * 0.5 + 0.25;
        wetP.gain.value = Math.min(1, wetVal);
        dryP.gain.value = 1 - Math.min(1, wetVal);
    }
    if (params['phaser-feedback'] !== undefined) {
        feedbackP.gain.value = params['phaser-feedback'];
    }
    // `phaser-stages` is not automatable, so this only runs on explicit writes.
    if (params['phaser-stages'] !== undefined) {
        wirePhaserStages(dn, params['phaser-stages']);
    }
}
