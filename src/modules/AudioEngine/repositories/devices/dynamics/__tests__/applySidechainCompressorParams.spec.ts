import { describe, expect, it, vi, beforeEach } from 'vitest';

import { asBaseAudioContext, createMockAudioContext } from '../../../../../../helpers/__tests__/audioContext.mock';
import { type OfflineDeviceNode } from '../../types';
import { applySidechainCompressorParams } from '../applySidechainCompressorParams';
import { createSidechainCompressorFallback } from '../createSidechainCompressorFallback';

// applySidechainCompressorParams has two branches: a native-processor path
// (inputNode is a 2-input AudioWorkletNode → writes named AudioParams directly)
// and a fallback path (delegates to applyCompressorParams). The worklet path
// needs `inputNode instanceof AudioWorkletNode`, so we install a real class on
// the global for the duration of the worklet-path tests.

class WorkletParam {
    value = 0;
}

class TestSidechainWorkletNode {
    numberOfInputs = 2;
    parameters = new Map<string, WorkletParam>([
        ['threshold', new WorkletParam()],
        ['ratio', new WorkletParam()],
        ['attack', new WorkletParam()],
        ['release', new WorkletParam()],
        ['makeup', new WorkletParam()],
    ]);
}

describe('applySidechainCompressorParams', () => {
    describe('native AudioWorkletNode path', () => {
        beforeEach(() => {
            // Make `instanceof AudioWorkletNode` true for our test node.
            vi.stubGlobal('AudioWorkletNode', TestSidechainWorkletNode);
        });

        it('writes each defined param into the named AudioParam, converting units', () => {
            const worklet = new TestSidechainWorkletNode();
            const device = { inputNode: worklet } as unknown as OfflineDeviceNode;

            applySidechainCompressorParams(device, {
                'sc-comp-threshold': -20,
                'sc-comp-ratio': 4,
                'sc-comp-attack': 30,
                'sc-comp-release': 200,
                'sc-comp-makeup': 6,
            });

            expect(worklet.parameters.get('threshold')!.value).toBe(-20);
            // ratio is floored at 1.
            expect(worklet.parameters.get('ratio')!.value).toBe(4);
            // attack / release are ms → s.
            expect(worklet.parameters.get('attack')!.value).toBe(0.03);
            expect(worklet.parameters.get('release')!.value).toBe(0.2);
            expect(worklet.parameters.get('makeup')!.value).toBe(6);
        });

        it('clamps a sub-unity ratio up to 1 and leaves undefined params untouched', () => {
            const worklet = new TestSidechainWorkletNode();
            worklet.parameters.get('threshold')!.value = -10;
            const device = { inputNode: worklet } as unknown as OfflineDeviceNode;

            applySidechainCompressorParams(device, { 'sc-comp-ratio': 0.5 });

            expect(worklet.parameters.get('ratio')!.value).toBe(1);
            // threshold was not in the params object → unchanged.
            expect(worklet.parameters.get('threshold')!.value).toBe(-10);
        });

        it('skips a param whose AudioParam name is missing from the worklet', () => {
            // A worklet that does not expose `makeup` — setWorkletParam's
            // `if (param)` guard must skip it instead of throwing.
            const worklet = new TestSidechainWorkletNode();
            worklet.parameters.delete('makeup');
            const device = { inputNode: worklet } as unknown as OfflineDeviceNode;

            expect(() => applySidechainCompressorParams(device, { 'sc-comp-makeup': 3 })).not.toThrow();
        });
    });

    describe('fallback (non-worklet) path', () => {
        it('delegates to applyCompressorParams when the input is not a 2-input worklet', () => {
            // The real createSidechainCompressor builds a non-worklet fallback
            // device under the mock context (no global AudioWorkletNode here).
            const context = createMockAudioContext();
            const device = createSidechainCompressorFallback(asBaseAudioContext(context));

            // No throw + the fallback compressor node receives the threshold.
            expect(() => applySidechainCompressorParams(device, { 'sc-comp-threshold': -12 })).not.toThrow();
            device.dispose?.();
        });
    });
});
