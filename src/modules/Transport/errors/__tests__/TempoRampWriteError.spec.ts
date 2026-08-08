import { describe, expect, it } from 'vitest';

import { createTempoRampWriteError } from '../TempoRampWriteError';

describe('createTempoRampWriteError', () => {
    it('creates an error with tag "TempoRampWrite"', () => {
        const error = createTempoRampWriteError({ bpm: 120, tempoChangeId: 'tc-1' });

        expect(error._tag).toBe('TempoRampWrite');
        expect(error).toBeInstanceOf(Error);
    });

    it('carries bpm and tempoChangeId as fields', () => {
        const error = createTempoRampWriteError({ bpm: 140.5, tempoChangeId: 'tc-abc' });

        expect(error.bpm).toBe(140.5);
        expect(error.tempoChangeId).toBe('tc-abc');
    });

    it('the message includes the bpm value', () => {
        const error = createTempoRampWriteError({ bpm: 90, tempoChangeId: 'tc-2' });

        expect(error.message).toContain('90');
        expect(error.message).toContain('BPM');
        expect(error.message).toContain('tempo ramp');
    });
});
