import { beforeEach, describe, expect, it } from 'vitest';

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
});
