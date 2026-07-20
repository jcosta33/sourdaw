import { beforeEach, describe, expect, it, vi } from 'vitest';

import { projectToasterPatternGroove } from '../projectToasterPatternGroove';
import { projectToasterStepEvents } from '../projectToasterStepEvents';

vi.mock('../projectToasterPatternGroove', () => ({
    projectToasterPatternGroove: vi.fn(),
}));

describe('projectToasterStepEvents', () => {
    beforeEach(() => {
        vi.mocked(projectToasterPatternGroove).mockImplementation((input) => ({
            ok: true,
            status: { status: 'unassigned' },
            events: input.events.map((event) => ({ ...event, startBeat: event.startBeat - 0.2 })),
        }));
    });

    it('wraps the complete hit interval across the pattern loop edge', () => {
        const projection = projectToasterStepEvents({
            deviceId: 'toaster-a',
            patternId: 'pattern-a',
            stepsPerBar: 16,
            loopLengthBeats: 4,
            padIndex: 0,
            stepIndex: 0,
            step: {
                active: true,
                velocity: 1,
                probability: 1,
                microTiming: 0,
                retriggerCount: 0,
                condition: 'always',
                paramLocks: {},
            },
            swing: 0,
        });

        expect(projection.ok).toBe(true);
        if (!projection.ok) {
            return;
        }
        expect(projection.hits).toHaveLength(2);
        expect(projection.hits[0]?.startBeat).toBeCloseTo(0, 12);
        expect(projection.hits[0]?.durationBeats).toBeCloseTo(0.025, 12);
        expect(projection.hits[1]?.startBeat).toBeCloseTo(3.8, 12);
        expect(projection.hits[1]?.durationBeats).toBeCloseTo(0.2, 12);
    });
});
