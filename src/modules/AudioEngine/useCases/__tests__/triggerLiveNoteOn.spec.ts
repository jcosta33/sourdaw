import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleNoteOn } from '../../repositories/webMidi/messageHandlers';
import { triggerLiveNoteOn } from '../triggerLiveNoteOn';

vi.mock('../../repositories/webMidi/messageHandlers', () => ({
    handleNoteOn: vi.fn(),
}));

describe('triggerLiveNoteOn', () => {
    beforeEach(() => {
        vi.mocked(handleNoteOn).mockClear();
    });

    it('should forward channel, note, and velocity to the Web MIDI handler', () => {
        triggerLiveNoteOn(2, 60, 100);

        expect(handleNoteOn).toHaveBeenCalledTimes(1);
        expect(handleNoteOn).toHaveBeenCalledWith(2, 60, 100);
    });
});
