import { type OfflineDeviceNode } from '../types';

import { applyCompressorParams } from './applyCompressorParams';

function setWorkletParam(workletNode: AudioWorkletNode, name: string, value: number): void {
    const param = workletNode.parameters.get(name);
    if (param) {
        param.value = value;
    }
}

export function applySidechainCompressorParams(dn: OfflineDeviceNode, params: Record<string, number>): void {
    if (
        typeof AudioWorkletNode !== 'undefined' &&
        dn.inputNode instanceof AudioWorkletNode &&
        dn.inputNode.numberOfInputs === 2
    ) {
        const threshold = params['sc-comp-threshold'];
        const ratio = params['sc-comp-ratio'];
        const attack = params['sc-comp-attack'];
        const release = params['sc-comp-release'];
        const makeup = params['sc-comp-makeup'];
        if (threshold !== undefined) {
            setWorkletParam(dn.inputNode, 'threshold', threshold);
        }
        if (ratio !== undefined) {
            setWorkletParam(dn.inputNode, 'ratio', Math.max(1, ratio));
        }
        if (attack !== undefined) {
            setWorkletParam(dn.inputNode, 'attack', attack / 1_000);
        }
        if (release !== undefined) {
            setWorkletParam(dn.inputNode, 'release', release / 1_000);
        }
        if (makeup !== undefined) {
            setWorkletParam(dn.inputNode, 'makeup', makeup);
        }
        return;
    }

    applyCompressorParams(dn, params, 'sc-comp');
}
