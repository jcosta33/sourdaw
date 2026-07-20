import { describe, expect, it } from 'vitest';

import { projectPpqEndpoints } from '../projectPpqEndpoints';

describe('projectPpqEndpoints', () => {
    it('should convert both endpoints through the integrated curved tempo map', () => {
        expect(
            projectPpqEndpoints({
                startPpq: 2,
                endPpq: 5,
                defaultTempo: 120,
                sampleRate: 48_000,
                changes: [
                    { id: 'ramp-start', beat: 0, tempo: 60, curve: 'linear' },
                    { id: 'ramp-end', beat: 8, tempo: 180, curve: 'instant' },
                ],
            })
        ).toEqual({
            startSamples: 77_849,
            endSamples: 155_699,
            durationSamples: 77_850,
            startSeconds: 77_849 / 48_000,
            endSeconds: 155_699 / 48_000,
            durationSeconds: 77_850 / 48_000,
        });
    });
});
