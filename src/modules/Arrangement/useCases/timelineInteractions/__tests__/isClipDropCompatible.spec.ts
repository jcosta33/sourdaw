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

    it('rejects non-content track kinds — bus, master, and folder tracks never take clip drops', () => {
        expect(isClipDropCompatible('audio', 'bus')).toBe(false);
        expect(isClipDropCompatible('midi', 'master')).toBe(false);
        expect(isClipDropCompatible('audio', 'folder')).toBe(false);
    });
});
