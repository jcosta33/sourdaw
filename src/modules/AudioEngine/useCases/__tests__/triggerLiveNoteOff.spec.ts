import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleNoteOff } from '../../repositories/webMidi/messageHandlers';
import { triggerLiveNoteOff } from '../triggerLiveNoteOff';

vi.mock('../../repositories/webMidi/messageHandlers', () => ({
    handleNoteOff: vi.fn(),
}));

describe('triggerLiveNoteOff', () => {
    beforeEach(() => {
        vi.mocked(handleNoteOff).mockClear();
    });

    it('should forward channel and note to the Web MIDI handler', () => {
        triggerLiveNoteOff(1, 72);

        expect(handleNoteOff).toHaveBeenCalledTimes(1);
        expect(handleNoteOff).toHaveBeenCalledWith(1, 72);
    });
});
