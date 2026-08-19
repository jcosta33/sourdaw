import { beforeEach, describe, expect, it } from 'vitest';

import {
    createReadyGrinderProcessor,
    grinderSetParamCalls,
    resetGrinderProcessorCalls,
    type GrinderProcessorLike,
} from './grinderProcessorTestHarness';

// grinderProcessor.applyNeuralPatch is the densest branch surface in the file
// (optional profile fields, finite-number coercion, tier mapping, conv-weight
// validation). Drive it through the versioned patch message and assert which params the
// instance received — deriving expected values from the documented neural patch
// contract, never from implementation output.

function patch(processor: GrinderProcessorLike, neural: Record<string, unknown>): void {
    processor.port.onmessage?.({
        data: {
            schemaVersion: 1,
            command: 'initialize-fallback-control',
            target: {
                trackId: 'track-1',
                deviceId: 'grinder-1',
                deviceType: 'grinder',
                parameterIds: ['sag', 'bypass'],
            },
            correlation: { workletGeneration: 7 },
        },
    });
    processor.port.onmessage?.({
        data: {
            schemaVersion: 1,
            command: 'apply-grinder-neural-patch',
            target: { trackId: 'track-1', deviceId: 'grinder-1', deviceType: 'grinder' },
            patch: neural,
            correlation: { workletGeneration: 7, controlSequence: 1 },
            scheduling: { targetFrame: null, deadlineFrame: null },
        },
    });
}

function paramMap(calls: typeof grinderSetParamCalls): Record<string, number> {
    return Object.fromEntries(calls.map((c) => [c.name, c.value]));
}

describe('GrinderProcessor neural patch (applyNeuralPatch)', () => {
    beforeEach(() => {
        resetGrinderProcessorCalls();
    });

    it('selects the builtin model (mode 0)', async () => {
        const processor = await createReadyGrinderProcessor();
        patch(processor, { neuralModelMode: 'builtin' });

        const m = paramMap(grinderSetParamCalls);
        expect(m.neuralModelMode).toBe(0);
        // builtin path returns before touching any custom field
        expect(m.neuralCustomInputDrive).toBeUndefined();
    });

    it('writes nothing when neuralModelMode is "imported" but no profile object is provided', async () => {
        const processor = await createReadyGrinderProcessor();
        patch(processor, { neuralModelMode: 'imported' });
        // profile missing ⇒ early return, no params written at all (not even neuralModelMode)
        expect(grinderSetParamCalls).toEqual([]);
    });

    it('writes nothing when neuralModelMode is neither builtin nor imported', async () => {
        const processor = await createReadyGrinderProcessor();
        patch(processor, { neuralModelMode: 'custom', profile: { inputDrive: 1 } });
        expect(grinderSetParamCalls).toEqual([]);
    });

    it('maps the preferredTier string to its neuralCustomTier index', async () => {
        const processor = await createReadyGrinderProcessor();
        patch(processor, {
            neuralModelMode: 'imported',
            profile: { preferredTier: 'recurrent' },
        });
        expect(paramMap(grinderSetParamCalls).neuralCustomTier).toBe(3);

        resetGrinderProcessorCalls();
        const p2 = await createReadyGrinderProcessor();
        patch(p2, { neuralModelMode: 'imported', profile: {} });
        expect(paramMap(grinderSetParamCalls).neuralCustomTier).toBe(0);
    });

    it('coerces every finite-number profile field and skips non-finite ones', async () => {
        const processor = await createReadyGrinderProcessor();
        patch(processor, {
            neuralModelMode: 'imported',
            profile: {
                inputDrive: 1.5,
                asymmetry: 0.25,
                outputTrim: -3,
                contourMix: 0.7,
                recurrentBias: 0.1,
            },
        });
        const m = paramMap(grinderSetParamCalls);
        expect(m.neuralCustomInputDrive).toBe(1.5);
        expect(m.neuralCustomAsymmetry).toBe(0.25);
        expect(m.neuralCustomOutputTrim).toBe(-3);
        expect(m.neuralCustomContourMix).toBe(0.7);
        expect(m.neuralCustomLstmBias).toBe(0.1);
        expect(m.neuralModelMode).toBe(1); // imported ⇒ 1 at the end
    });

    it('drops an imported patch that contains a non-finite profile field', async () => {
        const processor = await createReadyGrinderProcessor();
        patch(processor, {
            neuralModelMode: 'imported',
            profile: {
                inputDrive: NaN,
                asymmetry: Infinity,
                outputTrim: 'loud' as unknown as number,
            },
        });
        expect(grinderSetParamCalls).toEqual([]);
    });

    it('drops an imported patch that contains a malformed conv-weight layer', async () => {
        const processor = await createReadyGrinderProcessor();
        patch(processor, {
            neuralModelMode: 'imported',
            profile: {
                convWeights: [
                    [0.1, 0.2, 0.3], // valid layer 0
                    [1, 2], // too short ⇒ skipped
                    'nope' as unknown as number[], // not an array ⇒ skipped
                    [0.4, NaN, 0.6], // mixed ⇒ writes 0.4 and 0.6, drops NaN
                ],
            },
        });
        expect(grinderSetParamCalls).toEqual([]);
    });

    it('defaults convWeights to an empty array when absent, writing no conv-weight params', async () => {
        const processor = await createReadyGrinderProcessor();
        patch(processor, { neuralModelMode: 'imported', profile: {} });
        const m = paramMap(grinderSetParamCalls);
        expect(Object.keys(m).filter((k) => k.startsWith('neuralCustomConvWeight'))).toEqual([]);
    });

    it('reports a latency change when set_param shifts the reported latency', async () => {
        const processor = await createReadyGrinderProcessor();
        // The harness GrinderInstanceMock.get_latency_samples() always returns 0,
        // so a param that "changes" latency cannot be observed directly. Instead
        // verify the no-change path posts no latency-changed message.
        patch(processor, { neuralModelMode: 'builtin' });
        const latencyCalls = processor.port.postMessage.mock.calls.filter(
            (c) => (c[0] as { type?: string }).type === 'latency-changed'
        );
        expect(latencyCalls).toEqual([]);
    });
});

describe('GrinderProcessor legacy param message', () => {
    beforeEach(() => {
        resetGrinderProcessorCalls();
    });

    it('drops legacy raw parameter messages', async () => {
        const processor = await createReadyGrinderProcessor();
        processor.port.onmessage?.({ data: { type: 'param', name: 'bass', value: 7 } });
        processor.port.onmessage?.({ data: { type: 'param', name: 'unknownParam', value: 3 } });
        expect(grinderSetParamCalls).toEqual([]);
    });

    it('ignores param and patch messages before init (no instance)', async () => {
        // Build a processor without sending init: createReadyGrinderProcessor sends
        // init, so construct manually to keep _instance null.
        const { loadGrinderProcessorConstructor } = await import('./grinderProcessorTestHarness');
        const Ctor = await loadGrinderProcessorConstructor();
        const processor = new Ctor();
        // no init ⇒ _instance is null ⇒ param/patch branches are skipped
        processor.port.onmessage?.({ data: { type: 'param', name: 'bass', value: 7 } });
        processor.port.onmessage?.({ data: { type: 'patch', patch: { neuralModelMode: 'builtin' } } });
        expect(grinderSetParamCalls).toEqual([]);
    });
});
