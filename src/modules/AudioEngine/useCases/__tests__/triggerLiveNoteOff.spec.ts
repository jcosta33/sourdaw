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

    it('should forward channel and note to the Web MIDI handler, defaulting release velocity to 0', () => {
        triggerLiveNoteOff(1, 72);

        expect(handleNoteOff).toHaveBeenCalledTimes(1);
        // Callers without a release-velocity get the documented explicit 0 default.
        expect(handleNoteOff).toHaveBeenCalledWith(1, 72, 0);
    });

    it('should forward an explicit release velocity to the Web MIDI handler', () => {
        triggerLiveNoteOff(1, 72, 0.5);

        expect(handleNoteOff).toHaveBeenCalledTimes(1);
        expect(handleNoteOff).toHaveBeenCalledWith(1, 72, 0.5);
    });
});
