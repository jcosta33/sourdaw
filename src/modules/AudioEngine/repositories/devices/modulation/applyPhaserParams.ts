import { type OfflineDeviceNode } from '../types';

export function applyPhaserParams(dn: OfflineDeviceNode, params: Record<string, number>): void {
    // nodes: [splitter, dry, wet, f0, f1, f2, f3, lfo, lfoGain, feedback, dry, wet]
    const filtersP = [dn.nodes[3], dn.nodes[4], dn.nodes[5], dn.nodes[6]] as BiquadFilterNode[];
    const lfoP = dn.nodes[7] as OscillatorNode;
    const lfoGainP = dn.nodes[8] as GainNode;
    const feedbackP = dn.nodes[9] as GainNode;
    const dryP = dn.nodes[1] as GainNode;
    const wetP = dn.nodes[2] as GainNode;
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
        for (const f of filtersP) {
            f.Q.value = params['phaser-stages']! > 6 ? 1 : 0.5;
        }
    }
}