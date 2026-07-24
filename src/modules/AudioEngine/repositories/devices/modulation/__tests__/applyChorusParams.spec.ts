import { describe, expect, it } from 'vitest';

import { asBaseAudioContext, createMockAudioContext } from '../../../../../../helpers/__tests__/audioContext.mock';
import { type OfflineDeviceNode } from '../../types';
import { applyChorusParams } from '../applyChorusParams';
import { createChorus } from '../createChorus';

function getAudioParam(device: OfflineDeviceNode, nodeName: string, property: string): AudioParam {
    const node = device.namedNodes?.[nodeName];
    const candidate: unknown = node ? Reflect.get(node, property) : null;
    if (typeof candidate !== 'object' || candidate === null || !('value' in candidate)) {
        throw new Error(`Expected ${nodeName}.${property} AudioParam`);
    }
    return candidate as AudioParam;
}

describe('applyChorusParams', () => {
    it('applies rate and depth to both stereo modulation branches', () => {
        const context = createMockAudioContext();
        const device = createChorus(asBaseAudioContext(context));

        applyChorusParams(device, { 'chorus-rate': 4, 'chorus-depth': 10 });

        expect(getAudioParam(device, 'lfo1', 'frequency').value).toBe(4);
        expect(getAudioParam(device, 'lfo2', 'frequency').value).toBe(4.8);
        expect(getAudioParam(device, 'lfoGain1', 'gain').value).toBe(0.01);
        expect(getAudioParam(device, 'lfoGain2', 'gain').value).toBe(0.01);
        device.dispose?.();
    });

    it('maps chorus-mix onto the wet/dry crossfade', () => {
        const context = createMockAudioContext();
        const device = createChorus(asBaseAudioContext(context));

        applyChorusParams(device, { 'chorus-mix': 0.25 });

        expect(getAudioParam(device, 'wet', 'gain').value).toBe(0.25);
        expect(getAudioParam(device, 'dry', 'gain').value).toBe(0.75);
        device.dispose?.();
    });

    // A device reconstructed without namedNodes (e.g. a legacy or external-node
    // chain) must still route params through the positional `nodes[]` fallback.
    // This covers every `?? dn.nodes[N]` arm.
    it('falls back to the positional nodes array when namedNodes is absent', () => {
        function param(): AudioParam {
            return { value: 0 } as unknown as AudioParam;
        }
        function osc(): OscillatorNode {
            return { frequency: param() } as unknown as OscillatorNode;
        }
        function gain(): GainNode {
            return { gain: param() } as unknown as GainNode;
        }
        // Indices mirror createChorus: 1=dry, 2=wet, 5=lfo1, 6=lfo2,
        // 7=lfoGain1, 8=lfoGain2.
        const dry = gain();
        const wet = gain();
        const lfo1 = osc();
        const lfo2 = osc();
        const lfoGain1 = gain();
        const lfoGain2 = gain();
        const device = {
            nodes: [
                undefined, // 0 splitter
                dry, // 1
                wet, // 2
                undefined, // 3 delay1
                undefined, // 4 delay2
                lfo1, // 5
                lfo2, // 6
                lfoGain1, // 7
                lfoGain2, // 8
                undefined, // 9 merger
            ],
            namedNodes: undefined,
        } as unknown as OfflineDeviceNode;

        applyChorusParams(device, { 'chorus-rate': 5, 'chorus-depth': 20, 'chorus-mix': 0.5 });

        expect(lfo1.frequency.value).toBe(5);
        expect(lfo2.frequency.value).toBe(6);
        expect(lfoGain1.gain.value).toBe(0.02);
        expect(lfoGain2.gain.value).toBe(0.02);
        expect(wet.gain.value).toBe(0.5);
        expect(dry.gain.value).toBe(0.5);
    });
});
