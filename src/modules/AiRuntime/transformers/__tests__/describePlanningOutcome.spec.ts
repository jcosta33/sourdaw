import { describe, expect, it } from 'vitest';

import { describePlanningOutcome } from '../describePlanningOutcome';

describe('describePlanningOutcome', () => {
    it('surfaces a denied outcome reason verbatim', () => {
        expect(
            describePlanningOutcome({
                kind: 'denied',
                reason: 'No AI backend is available for this request. Configure a hosted provider in the desktop app or use a WebGPU-capable browser.',
            })
        ).toBe(
            'No AI backend is available for this request. Configure a hosted provider in the desktop app or use a WebGPU-capable browser.'
        );
    });
});
