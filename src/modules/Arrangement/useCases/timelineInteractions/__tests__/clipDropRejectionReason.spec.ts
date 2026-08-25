import { describe, it, expect } from 'vitest';

import { clipDropRejectionReason } from '../clipDropRejectionReason';

describe('clipDropRejectionReason', () => {
    it('names the offending combination', () => {
        expect(clipDropRejectionReason('audio', 'midi')).toMatch(/MIDI/);
        expect(clipDropRejectionReason('midi', 'audio')).toMatch(/audio/);
    });
});
