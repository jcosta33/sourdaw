import { describe, it, expect, vi, beforeEach } from 'vitest';

const getActiveInputMock = vi.hoisted(() => vi.fn<MIDIInput | null, []>());
const setActiveInputMock = vi.hoisted(() => vi.fn<void, [MIDIInput | null]>());
const onMidiMessageMock = vi.hoisted(() => vi.fn());

vi.mock('../../getActiveInput', () => ({
    getActiveInput: () => getActiveInputMock(),
}));

vi.mock('../../setActiveInput', () => ({
    setActiveInput: (input: MIDIInput | null) => setActiveInputMock(input),
}));

vi.mock('../../messageHandlers', () => ({
    onMidiMessage: onMidiMessageMock,
}));

import { attachInput } from '../helpers';

describe('webMidi/lifecycle/helpers', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('attachInput', () => {
        it('should set active input and subscribe to midimessage', () => {
            getActiveInputMock.mockReturnValue(null);
            const input = {
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
            } as unknown as MIDIInput;

            attachInput(input);

            expect(setActiveInputMock).toHaveBeenCalledWith(input);
            expect(input.addEventListener).toHaveBeenCalledWith('midimessage', onMidiMessageMock);
            expect(input.removeEventListener).not.toHaveBeenCalled();
        });

        it('should remove listener from previous input when switching devices', () => {
            const previous = {
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
            } as unknown as MIDIInput;
            const next = {
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
            } as unknown as MIDIInput;
            getActiveInputMock.mockReturnValue(previous);

            attachInput(next);

            expect(previous.removeEventListener).toHaveBeenCalledWith('midimessage', onMidiMessageMock);
            expect(setActiveInputMock).toHaveBeenCalledWith(next);
            expect(next.addEventListener).toHaveBeenCalledWith('midimessage', onMidiMessageMock);
        });

        it('should not remove listener when re-attaching the same input', () => {
            const input = {
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
            } as unknown as MIDIInput;
            getActiveInputMock.mockReturnValue(input);

            attachInput(input);

            expect(input.removeEventListener).not.toHaveBeenCalled();
            expect(setActiveInputMock).toHaveBeenCalledWith(input);
            expect(input.addEventListener).toHaveBeenCalledWith('midimessage', onMidiMessageMock);
        });
    });
});
