import { type OfflineDeviceNode } from '../types';

export function applyPhaserParams(dn: OfflineDeviceNode, params: Record<string, number>): void {
    const nn = dn.namedNodes;
    // nodes: [splitter, dry, wet, f0, f1, f2, f3, lfo, lfoGain, feedback, dry, wet]
    const filtersP = nn
        ? ([nn.filter0, nn.filter1, nn.filter2, nn.filter3] as BiquadFilterNode[])
        : ([dn.nodes[3], dn.nodes[4], dn.nodes[5], dn.nodes[6]] as BiquadFilterNode[]);
    const lfoP = (nn?.lfo ?? dn.nodes[7]) as OscillatorNode;
    const lfoGainP = (nn?.lfoGain ?? dn.nodes[8]) as GainNode;
    const feedbackP = (nn?.feedback ?? dn.nodes[9]) as GainNode;
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
    if (params['phaser-stages'] !== undefined) {
        for (const freq of filtersP) {
            freq.Q.value = params['phaser-stages'] > 6 ? 1 : 0.5;
        }
    }
}
