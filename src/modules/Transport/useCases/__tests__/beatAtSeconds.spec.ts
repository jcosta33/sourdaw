import { describe, expect, it } from 'vitest';

import { beatAtSeconds } from '../beatAtSeconds';
import { secondsBetweenBeats } from '../secondsBetweenBeats';

describe('beatAtSeconds', () => {
    it('inverts an instant change on a captured map', () => {
        const changes = [
            { id: 'fast', beat: 0, tempo: 120, curve: 'instant' as const },
            { id: 'slow', beat: 4, tempo: 60, curve: 'instant' as const },
        ];

        expect(beatAtSeconds(changes, secondsBetweenBeats(changes, 0, 5.2, 120), 120)).toBeCloseTo(5.2, 10);
    });

    it('inverts a linear ramp without replacing it with an endpoint tempo', () => {
        const changes = [
            { id: 'start', beat: 0, tempo: 120, curve: 'linear' as const },
            { id: 'end', beat: 4, tempo: 60, curve: 'instant' as const },
        ];

        expect(beatAtSeconds(changes, secondsBetweenBeats(changes, 0, 2.5, 120), 120)).toBeCloseTo(2.5, 10);
    });
});
