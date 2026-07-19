import { beforeEach, describe, expect, it } from 'vitest';

import {
    createReadyGrinderProcessor,
    getGrinderAutomationHeader,
    getGrinderAutomationValue,
    grinderAutomatedProcessSizes,
    grinderSetParamCalls,
    resetGrinderProcessorCalls,
} from './grinderProcessorTestHarness';

describe('grinderAudioParamKRate', () => {
    beforeEach(() => {
        resetGrinderProcessorCalls();
    });

    it('uses the only AudioParam value for the entire render quantum', async () => {
        const processor = await createReadyGrinderProcessor();
        const frames = 4;

        processor.process(
            [[new Float32Array(frames), new Float32Array(frames)]],
            [[new Float32Array(frames), new Float32Array(frames)]],
            { gain: new Float32Array([3.25]) }
        );

        expect(grinderSetParamCalls).toEqual([]);
        expect(getGrinderAutomationHeader(0)).toBe(1);
        expect(getGrinderAutomationValue(0, 0)).toBe(3.25);
        expect(grinderAutomatedProcessSizes).toEqual([frames]);
    });
});
