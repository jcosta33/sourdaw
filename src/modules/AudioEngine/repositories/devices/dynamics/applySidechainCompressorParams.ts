import { type OfflineDeviceNode } from '../types';

function setWorkletParam(workletNode: AudioWorkletNode, name: string, value: number): void {
    const param = workletNode.parameters.get(name);
    if (param) {
        param.value = value;
    }
}

function isGainNode(node: AudioNode): node is GainNode {
    return 'gain' in node;
}

// Worklet unavailable: the node is a Makeup gain, the only parameter that still has an effect.
function applyDegradedMakeup(dn: OfflineDeviceNode, makeupDb: number | undefined): void {
    const makeupNode = dn.namedNodes?.makeup;
    if (makeupNode && isGainNode(makeupNode) && makeupDb !== undefined) {
        makeupNode.gain.value = 10 ** (makeupDb / 20);
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

    applyDegradedMakeup(dn, params['sc-comp-makeup']);
}
