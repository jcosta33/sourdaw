import { beforeEach, describe, expect, it } from 'vitest';

import {
    createReadyGrinderProcessor,
    grinderProcessSizes,
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

        expect(grinderSetParamCalls.filter(({ name }) => name === 'gain')).toEqual([{ name: 'gain', value: 3.25 }]);
        expect(grinderProcessSizes).toEqual([4]);
    });
});
