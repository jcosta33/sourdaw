import { describe, expect, it } from 'vitest';

import { projectRealtimeMidiEventSampleTime } from '../projectRealtimeMidiEventSampleTime';

describe('projectRealtimeMidiEventSampleTime', () => {
    it('keeps the live AudioContext frame origin and applies only the PPQ delta', () => {
        const inputSampleTime = 480_000;
        const projectPpqToSamples = (ppq: number): number => ppq * 24_000;

        expect(
            projectRealtimeMidiEventSampleTime({
                inputSampleTime,
                inputPpq: 8,
                eventPpq: 8.5,
                projectPpqToSamples,
            })
        ).toBe(492_000);
    });
});
