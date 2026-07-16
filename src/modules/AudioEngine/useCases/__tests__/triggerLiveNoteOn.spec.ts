import { describe, it, expect, vi, beforeEach } from 'vitest';

import { triggerLiveNoteOn } from '../triggerLiveNoteOn';
import { handleWebMidiNoteOn } from '../webMidiInput/handleWebMidiNoteOn';

vi.mock('../webMidiInput/handleWebMidiNoteOn', () => ({
    handleWebMidiNoteOn: vi.fn(),
}));

describe('triggerLiveNoteOn', () => {
    beforeEach(() => {
        vi.mocked(handleWebMidiNoteOn).mockReset();
        vi.mocked(handleWebMidiNoteOn).mockResolvedValue(undefined);
    });

    it('should forward channel, note, and velocity to the Web MIDI handler', async () => {
        await triggerLiveNoteOn(2, 60, 100);

        expect(handleWebMidiNoteOn).toHaveBeenCalledTimes(1);
        expect(handleWebMidiNoteOn).toHaveBeenCalledWith(2, 60, 100);
    });

    it('should return the handler promise so rejections remain observable', async () => {
        const error = new Error('Web MIDI note-on failed');
        vi.mocked(handleWebMidiNoteOn).mockRejectedValueOnce(error);

        await expect(triggerLiveNoteOn(2, 60, 100)).rejects.toBe(error);
    });
});
