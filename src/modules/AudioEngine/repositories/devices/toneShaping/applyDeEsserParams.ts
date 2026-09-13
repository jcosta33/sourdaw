import { dbToGain } from '#/utils/audioLevelLaw';

import { type OfflineDeviceNode } from '../types';

export function applyDeEsserParams(dn: OfflineDeviceNode, params: Record<string, number>): void {
    const nn = dn.namedNodes;
    const bandpassDE = (nn?.bandpass ?? dn.nodes[1]) as BiquadFilterNode;
    const wetDE = (nn?.wet ?? dn.nodes[3]) as GainNode;
    const cancelDE = (nn?.cancel ?? dn.nodes[4]) as GainNode;
    const listenDE = (nn?.listen ?? dn.nodes[5]) as GainNode;
    const inputGainDE = (nn?.inputGain ?? dn.nodes[6]) as GainNode;
    const threshLinDE = (nn?.threshLin ?? dn.nodes[10]) as ConstantSourceNode;
    if (params['deess-threshold'] !== undefined) {
        // The threshold enters the reduction law as a linear subtractor: the
        // envelope sum is `envelope − 10^(threshold/20)`, so the constant
        // source carries the negated linear gain (see createDeEsser).
        threshLinDE.offset.value = -dbToGain(params['deess-threshold']);
    }
    if (params['deess-freq'] !== undefined) {
        bandpassDE.frequency.value = params['deess-freq'];
    }
    if (params['deess-range'] !== undefined) {
        // Range is the reduction LIMIT in dB: both band taps carry
        // 10^(range/20), so a fully compressed band is attenuated by exactly
        // Range dB and an idle band cancels to unity.
        const weight = dbToGain(params['deess-range']);
        wetDE.gain.value = weight;
        cancelDE.gain.value = -weight;
    }
    if (params['deess-listen'] !== undefined) {
        // Listen isolates the selected band: the full-range path mutes and the
        // raw detector band alone reaches the output.
        const listening = params['deess-listen'] !== 0;
        listenDE.gain.value = listening ? 1 : 0;
        inputGainDE.gain.value = listening ? 0 : 1;
    }
}
