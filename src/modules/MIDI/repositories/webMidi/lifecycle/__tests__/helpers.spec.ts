import { describe, it, expect, vi, beforeEach } from 'vitest';

const getActiveInputMock = vi.hoisted(() => vi.fn<() => MIDIInput | null>());
const setActiveInputMock = vi.hoisted(() => vi.fn<(input: MIDIInput | null) => void>());

vi.mock('../../getActiveInput', () => ({
    getActiveInput: () => getActiveInputMock(),
}));

vi.mock('../../setActiveInput', () => ({
    setActiveInput: (input: MIDIInput | null) => setActiveInputMock(input),
}));

import { heldPedalState } from '../../heldPedalState';
import { ingestChannelControlChange } from '../../ingestChannelControlChange';
import { memberExpressionState, setMemberExpression } from '../../memberExpressionState';
import { resetChannelControllerState } from '../../resetChannelControllerState';
import { detachActiveInput } from '../detachActiveInput';
import { attachInput } from '../helpers';

const { webMidiRuntime } = await import('../../state');

describe('webMidi/lifecycle/helpers', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        webMidiRuntime.midiMessageListener = null;
        resetChannelControllerState();
        heldPedalState.clear();
    });

    const holdSustainPedal = (): void => {
        ingestChannelControlChange({ channel: 0, cc: 64, value: 127 });
        expect(heldPedalState.get(0)?.get(64)).toBe(127);
    };

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
            setMemberExpression(1, { pressure: 80 });

            attachInput({ input: next, onMidiMessage: nextCallback });

            expect(previous.removeEventListener).toHaveBeenCalledWith('midimessage', firstCallback);
            expect(setActiveInputMock).toHaveBeenCalledWith(next);
            expect(next.addEventListener).toHaveBeenCalledWith('midimessage', nextCallback);
            expect(memberExpressionState.get(1)).toBeUndefined();
        });

        it('drops a held pedal when the input changes, so the next take is not seeded with it', () => {
            const previous = { addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as MIDIInput;
            const next = { addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as MIDIInput;
            getActiveInputMock.mockReturnValue(previous);
            holdSustainPedal();

            attachInput({ input: next, onMidiMessage: vi.fn() });

            expect(heldPedalState.get(0)?.get(64)).toBeUndefined();
        });

        it('keeps a held pedal when the same input is attached again', () => {
            const input = { addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as MIDIInput;
            getActiveInputMock.mockReturnValue(input);
            holdSustainPedal();

            attachInput({ input, onMidiMessage: vi.fn() });

            expect(heldPedalState.get(0)?.get(64)).toBe(127);
        });

        it('should not remove listener when re-attaching the same input', () => {
            const input = {
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
            } as unknown as MIDIInput;
            const onMidiMessageMock = vi.fn();
            getActiveInputMock.mockReturnValue(input);
            setMemberExpression(1, { pressure: 80 });

            attachInput({ input, onMidiMessage: onMidiMessageMock });

            expect(input.removeEventListener).not.toHaveBeenCalled();
            expect(setActiveInputMock).toHaveBeenCalledWith(input);
            expect(input.addEventListener).toHaveBeenCalledWith('midimessage', onMidiMessageMock);
            expect(memberExpressionState.get(1)?.pressure).toBe(80);
        });
    });

    it('drops a held pedal when the input disconnects, so the next take is not seeded with it', () => {
        const input = { removeEventListener: vi.fn(), onmidimessage: vi.fn() } as unknown as MIDIInput;
        getActiveInputMock.mockReturnValue(input);
        webMidiRuntime.midiMessageListener = vi.fn();
        holdSustainPedal();

        detachActiveInput();

        expect(heldPedalState.get(0)?.get(64)).toBeUndefined();
    });

    it('drops the old member values when the input disconnects', () => {
        const input = { removeEventListener: vi.fn(), onmidimessage: vi.fn() } as unknown as MIDIInput;
        getActiveInputMock.mockReturnValue(input);
        webMidiRuntime.midiMessageListener = vi.fn();
        setMemberExpression(1, { pressure: 80 });

        detachActiveInput();

        expect(memberExpressionState.get(1)).toBeUndefined();
        expect(setActiveInputMock).toHaveBeenCalledWith(null);
    });
});
