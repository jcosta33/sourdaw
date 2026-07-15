import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createWebMidiNoteKey } from '../../../models/WebMidiTypes';

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
        const matchingKey = createWebMidiNoteKey(3, 62);
        const otherKey = createWebMidiNoteKey(4, 62);
        activeNotes.set(matchingKey, { channel: 3, note: 62, trackId: 'track-a', startTime: 0, startBeat: 0 });
        activeNotes.set(otherKey, { channel: 4, note: 62, trackId: 'track-b', startTime: 0, startBeat: 0 });
        channelToNote.set(3, matchingKey);
        channelToNote.set(4, otherKey);

        handleWebMidiChannelPressure(3, 87);

        expect(activeNotes.get(matchingKey)?.pressure).toBe(87);
        expect(activeNotes.get(otherKey)?.pressure).toBeUndefined();
    });

    it('should not update pressure when MPE is disabled', () => {
        mpe_enabled.value = false;
        const key = createWebMidiNoteKey(3, 62);
        activeNotes.set(key, { channel: 3, note: 62, trackId: 'track-a', startTime: 0, startBeat: 0 });
        channelToNote.set(3, key);

        handleWebMidiChannelPressure(3, 87);

        expect(activeNotes.get(key)?.pressure).toBeUndefined();
    });
});
