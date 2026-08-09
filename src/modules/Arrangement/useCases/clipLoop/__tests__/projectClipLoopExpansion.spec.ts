import { describe, expect, it } from 'vitest';

import {
    MAX_CLIP_LOOP_ITERATIONS,
    MIN_CLIP_LOOP_LENGTH_BEATS,
    projectClipLoopExpansion,
} from '../projectClipLoopExpansion';

describe('projectClipLoopExpansion', () => {
    it('enforces the project-tick floor and the shared maximum iteration count', () => {
        expect(
            projectClipLoopExpansion({
                clipDurationBeats: 1,
                configuredLoopLengthBeats: Number.MIN_VALUE,
                loopEnabled: true,
            })
        ).toEqual({ iterationCount: 480, loopLengthBeats: MIN_CLIP_LOOP_LENGTH_BEATS });

        expect(
            projectClipLoopExpansion({
                clipDurationBeats: 10,
                configuredLoopLengthBeats: Number.MIN_VALUE,
                loopEnabled: true,
            })
        ).toEqual({
            iterationCount: MAX_CLIP_LOOP_ITERATIONS,
            loopLengthBeats: 10 / MAX_CLIP_LOOP_ITERATIONS,
        });
    });

    it('bounds malformed persisted data and leaves disabled clips dormant', () => {
        expect(
            projectClipLoopExpansion({
                clipDurationBeats: 0,
                configuredLoopLengthBeats: 2,
                loopEnabled: true,
            })
        ).toEqual({ iterationCount: 0, loopLengthBeats: MIN_CLIP_LOOP_LENGTH_BEATS });
        expect(
            projectClipLoopExpansion({
                clipDurationBeats: 8,
                configuredLoopLengthBeats: Number.NaN,
                loopEnabled: true,
            })
        ).toEqual({ iterationCount: 1, loopLengthBeats: 8 });
        expect(
            projectClipLoopExpansion({
                clipDurationBeats: 8,
                configuredLoopLengthBeats: 2,
                loopEnabled: false,
            })
        ).toEqual({ iterationCount: 1, loopLengthBeats: 8 });
    });
});
