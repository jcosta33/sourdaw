import { describe, it, expect, vi, beforeEach } from 'vitest';

const getActiveInputMock = vi.hoisted(() => vi.fn<() => MIDIInput | null>());
const setActiveInputMock = vi.hoisted(() => vi.fn<(input: MIDIInput | null) => void>());

vi.mock('../../getActiveInput', () => ({
    getActiveInput: () => getActiveInputMock(),
}));

vi.mock('../../setActiveInput', () => ({
    setActiveInput: (input: MIDIInput | null) => setActiveInputMock(input),
}));

import { attachInput } from '../helpers';

const { webMidiRuntime } = await import('../../state');

describe('webMidi/lifecycle/helpers', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        webMidiRuntime.midiMessageListener = null;
    });

    describe('attachInput', () => {
        it('should set active input and subscribe to midimessage', () => {
            getActiveInputMock.mockReturnValue(null);
            const input = {
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
            } as unknown as MIDIInput;
            const onMidiMessageMock = vi.fn();

            attachInput({ input, onMidiMessage: onMidiMessageMock });

            expect(setActiveInputMock).toHaveBeenCalledWith(input);
            expect(input.addEventListener).toHaveBeenCalledWith('midimessage', onMidiMessageMock);
            expect(input.removeEventListener).not.toHaveBeenCalled();
        });

        it('should remove the same listener that was added to the previous input when switching devices', () => {
            const previous = {
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
            } as unknown as MIDIInput;
            const next = {
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
            } as unknown as MIDIInput;
            const firstCallback = vi.fn();
            const nextCallback = vi.fn();

            getActiveInputMock.mockReturnValue(null);
            attachInput({ input: previous, onMidiMessage: firstCallback });
            getActiveInputMock.mockReturnValue(previous);

            attachInput({ input: next, onMidiMessage: nextCallback });

            expect(previous.removeEventListener).toHaveBeenCalledWith('midimessage', firstCallback);
            expect(setActiveInputMock).toHaveBeenCalledWith(next);
            expect(next.addEventListener).toHaveBeenCalledWith('midimessage', nextCallback);
        });

        it('should not remove listener when re-attaching the same input', () => {
            const input = {
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
            } as unknown as MIDIInput;
            const onMidiMessageMock = vi.fn();
            getActiveInputMock.mockReturnValue(input);

            attachInput({ input, onMidiMessage: onMidiMessageMock });

            expect(input.removeEventListener).not.toHaveBeenCalled();
            expect(setActiveInputMock).toHaveBeenCalledWith(input);
            expect(input.addEventListener).toHaveBeenCalledWith('midimessage', onMidiMessageMock);
        });
    });
});
