import { beforeEach, describe, expect, it } from 'vitest';

import {
    createReadyGrinderProcessor,
    grinderProcessSizes,
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

        expect(grinderSetParamCalls.filter(({ name }) => name === 'gain').map(({ value }) => value)).toEqual([
            1, 2, 3, 4,
        ]);
        expect(grinderProcessSizes).toEqual([1, 1, 1, 1]);
    });
});
