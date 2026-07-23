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
});
