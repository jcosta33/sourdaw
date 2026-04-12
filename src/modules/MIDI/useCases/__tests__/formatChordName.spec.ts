import { describe, it, expect } from 'vitest';

import { formatChordName } from '../formatChordName';

describe('formatChordName', () => {
    it('should format major chords as the root only', () => {
        expect(
            formatChordName({
                id: '1',
                beat: 0,
                root: 0,
                quality: 'major',
                duration: 4,
            })
        ).toBe('C');
    });

    it('should append the quality for non-major chords', () => {
        expect(
            formatChordName({
                id: '2',
                beat: 0,
                root: 9,
                quality: 'min7',
                duration: 2,
            })
        ).toBe('Amin7');
    });
});
