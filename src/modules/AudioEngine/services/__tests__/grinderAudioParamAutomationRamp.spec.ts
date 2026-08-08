import { beforeEach, describe, expect, it } from 'vitest';

import grinderAudioParamContract from '../grinderAudioParamContract.json';

import {
    createReadyGrinderProcessor,
    getGrinderAutomationHeader,
    getGrinderAutomationValue,
    grinderAutomatedProcessSizes,
    grinderSetParamCalls,
    resetGrinderProcessorCalls,
} from './grinderProcessorTestHarness';

describe('grinderAudioParamAutomationRamp', () => {
    beforeEach(() => {
        resetGrinderProcessorCalls();
    });

    it('applies each a-rate value before rendering its corresponding sample', async () => {
        const processor = await createReadyGrinderProcessor();
        const frames = 4;

        processor.process(
            [[new Float32Array(frames), new Float32Array(frames)]],
            [[new Float32Array(frames), new Float32Array(frames)]],
            { gain: new Float32Array([1, 2, 3, 4]) }
        );

        expect(grinderSetParamCalls).toEqual([]);
        expect(getGrinderAutomationHeader(0)).toBe(frames);
        expect([0, 1, 2, 3].map((frame) => getGrinderAutomationValue(0, frame))).toEqual([1, 2, 3, 4]);
        expect(grinderAutomatedProcessSizes).toEqual([frames]);
    });

    /**
     * The base offset alone is observable at ordinal 0; the per-parameter stride
     * is not. Writing two parameters at once, one of them the contract's last
     * ordinal, pins `base + index * MAX_GRINDER_BLOCK_SIZE` as a whole — the same
     * expression `apply_automatable_frame` uses on the Rust side, whose agreement
     * with this one is welded to the shipped binary by
     * `wasm/__tests__/dawDspGrinderAutomationLayout.spec.ts`. Values are distinct
     * per parameter so a collapsed stride would land them on each other.
     */
    it('keeps each parameter’s values in its own strided block, up to the contract’s last ordinal', async () => {
        const processor = await createReadyGrinderProcessor();
        const frames = 4;
        // Derived, not restated: the ordinal that would move first if the
        // contract grew is the one this has to reach.
        const lastOrdinal = grinderAudioParamContract.length - 1;
        const lastParamName = grinderAudioParamContract[lastOrdinal]?.name ?? '';
        // Exactly representable in f32, so the round-trip through the mock's
        // Float32Array view compares as written.
        const lastParamValues = [0.25, 0.5, 0.75, 1];

        processor.process(
            [[new Float32Array(frames), new Float32Array(frames)]],
            [[new Float32Array(frames), new Float32Array(frames)]],
            { gain: new Float32Array([1, 2, 3, 4]), [lastParamName]: new Float32Array(lastParamValues) }
        );

        expect(getGrinderAutomationHeader(lastOrdinal)).toBe(frames);
        expect([0, 1, 2, 3].map((frame) => getGrinderAutomationValue(lastOrdinal, frame))).toEqual(lastParamValues);
        expect([0, 1, 2, 3].map((frame) => getGrinderAutomationValue(0, frame))).toEqual([1, 2, 3, 4]);
    });
});
