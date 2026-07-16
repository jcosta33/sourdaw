import { vi, describe, it, expect, beforeEach } from 'vitest';

type TestMidiInput = Pick<MIDIInput, 'removeEventListener'> & {
    onmidimessage: MIDIInput['onmidimessage'];
};

const getMidiAccessMock = vi.hoisted(() => vi.fn<unknown, []>());
const getActiveInputMock = vi.hoisted(() => vi.fn<TestMidiInput | null, []>());
const getStateMock = vi.hoisted(() => vi.fn(() => ({ isSupported: true, inputs: [], selectedInputId: null })));
const requestMidiAccessMock = vi.hoisted(() => vi.fn<Promise<unknown>, []>());
const setActiveInputMock = vi.hoisted(() => vi.fn<void, [TestMidiInput | null]>());
const setMidiAccessMock = vi.hoisted(() => vi.fn<void, [MIDIAccess]>());
const setStateMock = vi.hoisted(() => vi.fn<void, [Record<string, unknown>]>());
const setTauriModeMock = vi.hoisted(() => vi.fn<void, [boolean]>());

// Must stub before importing the subject
vi.stubGlobal('navigator', {
    requestMIDIAccess: requestMidiAccessMock,
});

import { isTauri, tauriInvoke } from '#/utils/tauriBridge';

import { webMidiRuntime } from '../../state';
import { attachInput } from '../helpers';
import { initWebMidi } from '../initWebMidi';
import { selectMidiInputTauri } from '../selectMidiInputTauri';

vi.mock('#/utils/tauriBridge', () => ({
    isTauri: vi.fn(),
    tauriInvoke: vi.fn(),
    tauriListen: vi.fn().mockResolvedValue(() => {}),
}));

vi.mock('../../getMidiAccess', () => ({
    getMidiAccess: () => getMidiAccessMock(),
}));

vi.mock('../../getActiveInput', () => ({
    getActiveInput: () => getActiveInputMock(),
}));

vi.mock('../../getState', () => ({
    getState: () => getStateMock(),
}));

vi.mock('../../setActiveInput', () => ({
    setActiveInput: (input: TestMidiInput | null) => setActiveInputMock(input),
}));

vi.mock('../../setMidiAccess', () => ({
    setMidiAccess: (access: MIDIAccess) => setMidiAccessMock(access),
}));

vi.mock('../../setState', () => ({
    setState: (next: Record<string, unknown>) => setStateMock(next),
}));

vi.mock('../../setTauriMode', () => ({
    setTauriMode: (enabled: boolean) => setTauriModeMock(enabled),
}));

vi.mock('../helpers', () => ({
    attachInput: vi.fn(),
}));

vi.mock('../selectMidiInputTauri', () => ({
    selectMidiInputTauri: vi.fn(),
}));

describe('initWebMidi', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should initialize via Web MIDI if supported', async () => {
        const onMidiMessage = vi.fn<void, [MIDIMessageEvent]>();
        const input = { id: 'in-1', name: 'Keyboard' };
        const mockAccess = {
            inputs: new Map([['in-1', input]]),
            onstatechange: null,
        };
        requestMidiAccessMock.mockResolvedValue(mockAccess);
        getMidiAccessMock.mockReturnValue(mockAccess);

        const result = await initWebMidi({ onMidiMessage });

        expect(result).toBe(true);
        expect(navigator.requestMIDIAccess).toHaveBeenCalled();
        expect(setMidiAccessMock).toHaveBeenCalledWith(mockAccess);
        expect(attachInput).toHaveBeenCalledWith({
            input,
            onMidiMessage,
        });
    });

    it('should fallback to Tauri if Web MIDI fails', async () => {
        const onMidiMessage = vi.fn<void, [MIDIMessageEvent]>();
        // Force failure of browser MIDI
        requestMidiAccessMock.mockRejectedValue(new Error('no access'));
        vi.mocked(isTauri).mockReturnValue(true);
        vi.mocked(tauriInvoke).mockResolvedValue([{ index: 0, name: 'Tauri MIDI' }]);

        const result = await initWebMidi({ onMidiMessage });

        expect(result).toBe(true);
        expect(setTauriModeMock).toHaveBeenCalledWith(true);
        expect(tauriInvoke).toHaveBeenCalledWith('list_midi_inputs');
        expect(selectMidiInputTauri).toHaveBeenCalledWith({ portIndex: 0, onMidiMessage });
    });

    it('should return false if neither is supported', async () => {
        const onMidiMessage = vi.fn<void, [MIDIMessageEvent]>();
        requestMidiAccessMock.mockRejectedValue(new Error('no access'));
        vi.mocked(isTauri).mockReturnValue(false);

        const result = await initWebMidi({ onMidiMessage });

        expect(result).toBe(false);
        expect(setStateMock).toHaveBeenCalledWith({ isSupported: false });
    });

    it('should remove the active event listener when the selected input disappears', async () => {
        const onMidiMessage = vi.fn<void, [MIDIMessageEvent]>();
        const activeInput = {
            onmidimessage: null,
            removeEventListener: vi.fn<void, [string, EventListener]>(),
        };
        const activeListener = vi.fn<void, [Event]>();
        const mockAccess = {
            inputs: new Map(),
            onstatechange: null as (() => void) | null,
        };
        webMidiRuntime.midiMessageListener = activeListener;
        requestMidiAccessMock.mockResolvedValue(mockAccess);
        getMidiAccessMock.mockReturnValue(mockAccess);
        getActiveInputMock.mockReturnValue(activeInput);
        getStateMock.mockReturnValue({ isSupported: true, inputs: [], selectedInputId: 'missing-input' });

        await initWebMidi({ onMidiMessage });
        mockAccess.onstatechange?.();

        expect(activeInput.removeEventListener).toHaveBeenCalledWith('midimessage', activeListener);
        expect(webMidiRuntime.midiMessageListener).toBeNull();
        expect(setActiveInputMock).toHaveBeenCalledWith(null);
    });
});
