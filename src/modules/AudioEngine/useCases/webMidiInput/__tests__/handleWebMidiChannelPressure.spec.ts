import { beforeEach, describe, expect, it, vi } from 'vitest';

const mpe_enabled = vi.hoisted(() => ({ value: true }));

vi.mock('../../../repositories/webMidi/getMpeEnabled', () => ({
    getMpeEnabled: () => mpe_enabled.value,
}));

const { handleWebMidiChannelPressure } = await import('../handleWebMidiChannelPressure');
const { activeNotes, channelToNote } = await import('../../../repositories/webMidi/state');

describe('handleWebMidiChannelPressure', () => {
    beforeEach(() => {
        activeNotes.clear();
        channelToNote.clear();
        mpe_enabled.value = true;
    });

    it('should store pressure on the active MPE note for the matching channel', () => {
        activeNotes.set(62, { channel: 3, startTime: 0, startBeat: 0 });
        channelToNote.set(3, 62);

        handleWebMidiChannelPressure(3, 87);

        expect(activeNotes.get(62)?.pressure).toBe(87);
    });

    it('should not update pressure when MPE is disabled', () => {
        mpe_enabled.value = false;
        activeNotes.set(62, { channel: 3, startTime: 0, startBeat: 0 });
        channelToNote.set(3, 62);

        handleWebMidiChannelPressure(3, 87);

        expect(activeNotes.get(62)?.pressure).toBeUndefined();
    });
});
