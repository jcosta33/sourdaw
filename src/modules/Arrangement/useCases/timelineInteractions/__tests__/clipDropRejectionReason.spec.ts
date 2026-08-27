import { describe, it, expect } from 'vitest';

import { clipDropRejectionReason } from '../clipDropRejectionReason';

describe('clipDropRejectionReason', () => {
    it('names the offending track kind', () => {
        expect(clipDropRejectionReason('midi')).toMatch(/MIDI/);
        expect(clipDropRejectionReason('audio')).toMatch(/audio/);
    });

    it('gives a generic reason for non-content tracks', () => {
        expect(clipDropRejectionReason('folder')).toMatch(/does not accept clips/i);
    });
});
