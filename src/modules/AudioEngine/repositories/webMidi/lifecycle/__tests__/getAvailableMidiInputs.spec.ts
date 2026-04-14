import { describe, it, expect, vi } from 'vitest';
import { type MidiInputInfo } from '../../../../models/WebMidiTypes';

const getStateMock = vi.hoisted(() =>
    vi.fn(() => ({
        isSupported: true,
        inputs: [] as MidiInputInfo[],
        selectedInputId: null as string | null,
    })),
);

vi.mock('../../state', () => ({
    getState: getStateMock,
}));

import { getAvailableMidiInputs } from '../getAvailableMidiInputs';

describe('getAvailableMidiInputs', () => {
    it('should return inputs from web MIDI state', () => {
        const inputs: MidiInputInfo[] = [{ id: 'in-1', name: 'Keyboard', manufacturer: 'X' }];
        getStateMock.mockReturnValueOnce({
            isSupported: true,
            inputs,
            selectedInputId: null,
        });
        expect(getAvailableMidiInputs()).toEqual(inputs);
    });
});
