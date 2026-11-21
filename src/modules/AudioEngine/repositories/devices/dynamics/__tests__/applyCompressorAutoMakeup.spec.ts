import { describe, expect, it } from 'vitest';

import { asBaseAudioContext, createMockAudioContext } from '../../../../../../helpers/__tests__/audioContext.mock';
import { createOfflineDeviceNode } from '../../../deviceNodeFactory';
import { applyBuiltinCompressorParams } from '../applyCompressorAutoMakeup';

type CallLog = { mock: { invocationCallOrder: number[] } };
type RecordedShaper = { connect: CallLog; disconnect: CallLog };

function createCompressorNode() {
    const context = createMockAudioContext();
    const deviceNode = createOfflineDeviceNode({
        context: asBaseAudioContext(context),
        deviceType: 'builtin-compressor',
    });
    if (!deviceNode) {
        throw new Error('Expected builtin-compressor factory');
    }
    // The mock's nodes carry a bare context stub; the twin is built from the node's own context.
    Object.defineProperty(deviceNode.nodes[0], 'context', { value: context });
    const trim = deviceNode.namedNodes?.autoMakeupTrim as GainNode | undefined;
    if (!trim) {
        throw new Error('Expected the compressor to name its Auto Makeup trim');
    }
    return { context, deviceNode, trim };
}

function lastCall(log: CallLog): number {
    return Math.max(0, ...log.mock.invocationCallOrder);
}

function isConnected(shaper: RecordedShaper): boolean {
    return lastCall(shaper.connect) > lastCall(shaper.disconnect);
}

describe('applyBuiltinCompressorParams Auto Makeup switch', () => {
    it('detaches the reciprocal and returns the trim to unity when the switch goes off then on', () => {
        const { context, deviceNode, trim } = createCompressorNode();

        applyBuiltinCompressorParams(deviceNode, { 'comp-auto-makeup': 0 });
        const reciprocal = context.createWaveShaper.mock.results[0]?.value as RecordedShaper | undefined;
        if (!reciprocal) {
            throw new Error('Expected switching off to build the reciprocal shaper');
        }

        expect(trim.gain.value).toBe(0);
        expect(isConnected(reciprocal)).toBe(true);

        applyBuiltinCompressorParams(deviceNode, { 'comp-auto-makeup': 1 });

        expect(trim.gain.value).toBe(1);
        expect(isConnected(reciprocal)).toBe(false);
    });
});
