import { describe, it, expect } from 'vitest';

import { isClipDropCompatible } from '../isClipDropCompatible';

describe('isClipDropCompatible', () => {
    it('accepts matching clip and track kinds', () => {
        expect(isClipDropCompatible('audio', 'audio')).toBe(true);
        expect(isClipDropCompatible('midi', 'midi')).toBe(true);
    });

    it('rejects an audio clip on a MIDI track and vice versa', () => {
        expect(isClipDropCompatible('audio', 'midi')).toBe(false);
        expect(isClipDropCompatible('midi', 'audio')).toBe(false);
    });

    it('leaves non-content track kinds to track eligibility', () => {
        expect(isClipDropCompatible('audio', 'bus')).toBe(true);
        expect(isClipDropCompatible('midi', 'folder')).toBe(true);
    });
});
