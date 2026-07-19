import { describe, expect, it } from 'vitest';

import {
    createReadyGrinderProcessor,
    getGrinderAutomationHeader,
    getGrinderAutomationValue,
    grinderAutomatedProcessSizes,
    grinderProcessSizes,
    grinderRightPtrCalls,
    grinderSetParamCalls,
    resetGrinderProcessorCalls,
} from './grinderProcessorTestHarness';

describe('grinderAudioParamRtSafety', () => {
    it('transfers all eleven parameters numerically and renders the quantum with one WASM call', async () => {
        const processor = await createReadyGrinderProcessor();
        resetGrinderProcessorCalls();
        const frames = 4;
        const parameters = {
            gain: new Float32Array([1, 2, 3, 4]),
            bass: new Float32Array([5]),
            mid: new Float32Array([5]),
            treble: new Float32Array([5]),
            presence: new Float32Array([5]),
            resonance: new Float32Array([5]),
            master: new Float32Array([5]),
            inputGain: new Float32Array([0]),
            outputGain: new Float32Array([0]),
            transformerDrive: new Float32Array([0.3]),
            negFeedback: new Float32Array([0.5]),
        };

        processor.process(
            [[new Float32Array(frames), new Float32Array(frames)]],
            [[new Float32Array(frames), new Float32Array(frames)]],
            parameters
        );

        expect(grinderSetParamCalls).toEqual([]);
        expect(grinderProcessSizes).toEqual([]);
        expect(grinderAutomatedProcessSizes).toEqual([frames]);
        expect(grinderRightPtrCalls).toBe(0);
        expect(getGrinderAutomationHeader(0)).toBe(frames);
        expect([0, 1, 2, 3].map((frame) => getGrinderAutomationValue(0, frame))).toEqual([1, 2, 3, 4]);
        expect(getGrinderAutomationHeader(6)).toBe(1);
        expect(getGrinderAutomationValue(6, 0)).toBe(5);
        expect(getGrinderAutomationHeader(10)).toBe(1);
        expect(getGrinderAutomationValue(10, 0)).toBe(0.5);
    });
});
