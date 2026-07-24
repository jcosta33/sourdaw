import { vi, describe, it, expect, beforeEach } from 'vitest';

type TestMidiInput = Pick<MIDIInput, 'removeEventListener'> & {
    onmidimessage: MIDIInput['onmidimessage'];
};

const getMidiAccessMock = vi.hoisted(() => vi.fn<() => unknown>());
const getActiveInputMock = vi.hoisted(() => vi.fn<() => TestMidiInput | null>());
const getStateMock = vi.hoisted(() =>
    vi.fn<() => { isSupported: boolean; inputs: unknown[]; selectedInputId: string | null }>(() => ({
        isSupported: true,
        inputs: [],
        selectedInputId: null,
    }))
);
const requestMidiAccessMock = vi.hoisted(() => vi.fn<() => Promise<unknown>>());
const setActiveInputMock = vi.hoisted(() => vi.fn<(input: TestMidiInput | null) => void>());
const setMidiAccessMock = vi.hoisted(() => vi.fn<(access: MIDIAccess) => void>());
const setStateMock = vi.hoisted(() => vi.fn<(next: Record<string, unknown>) => void>());
const setTauriModeMock = vi.hoisted(() => vi.fn<(enabled: boolean) => void>());

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
        getStateMock.mockReturnValue({ isSupported: true, inputs: [], selectedInputId: null });
    });

    it('should initialize via Web MIDI if supported', async () => {
        const onMidiMessage = vi.fn<(event: MIDIMessageEvent) => void>();
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
        const onMidiMessage = vi.fn<(event: MIDIMessageEvent) => void>();
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
        const onMidiMessage = vi.fn<(event: MIDIMessageEvent) => void>();
        requestMidiAccessMock.mockRejectedValue(new Error('no access'));
        vi.mocked(isTauri).mockReturnValue(false);

        const result = await initWebMidi({ onMidiMessage });

        expect(result).toBe(false);
        expect(setStateMock).toHaveBeenCalledWith({ isSupported: false });
    });

    it('should remove the active event listener when the selected input disappears', async () => {
        const onMidiMessage = vi.fn<(event: MIDIMessageEvent) => void>();
        const activeInput = {
            onmidimessage: null,
            removeEventListener: vi.fn<(type: string, listener: EventListener) => void>(),
        };
        const activeListener = vi.fn<(event: Event) => void>();
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

    it('should auto-select the first available input when the selected one disappears but others remain', async () => {
        const onMidiMessage = vi.fn<(event: MIDIMessageEvent) => void>();
        const input = { id: 'in-2', name: 'Keyboard' };
        const mockAccess = {
            inputs: new Map([['in-2', input]]),
            onstatechange: null as (() => void) | null,
        };
        requestMidiAccessMock.mockResolvedValue(mockAccess);
        getMidiAccessMock.mockReturnValue(mockAccess);
        getStateMock.mockReturnValue({ isSupported: true, inputs: [], selectedInputId: 'gone-input' });
        vi.mocked(attachInput).mockClear();

        await initWebMidi({ onMidiMessage });
        mockAccess.onstatechange?.();

        expect(attachInput).toHaveBeenCalledWith({ input, onMidiMessage });
        expect(setStateMock).toHaveBeenCalledWith({
            inputs: [expect.objectContaining({ id: 'in-2' })],
            selectedInputId: 'in-2',
        });
    });

    it('should keep the selected input attached when it still exists on state change', async () => {
        const onMidiMessage = vi.fn<(event: MIDIMessageEvent) => void>();
        const input = { id: 'in-1', name: 'Keyboard' };
        const mockAccess = {
            inputs: new Map([['in-1', input]]),
            onstatechange: null as (() => void) | null,
        };
        requestMidiAccessMock.mockResolvedValue(mockAccess);
        getMidiAccessMock.mockReturnValue(mockAccess);
        getStateMock.mockReturnValue({ isSupported: true, inputs: [], selectedInputId: 'in-1' });
        vi.mocked(attachInput).mockClear();

        await initWebMidi({ onMidiMessage });
        vi.mocked(attachInput).mockClear();
        mockAccess.onstatechange?.();

        // selected still exists -> no re-attach, selectedInputId retained
        expect(attachInput).not.toHaveBeenCalled();
        expect(setStateMock).toHaveBeenLastCalledWith({
            inputs: [expect.objectContaining({ id: 'in-1' })],
            selectedInputId: 'in-1',
        });
    });

    it('should return false and warn when MIDI is reported unsupported', async () => {
        const onMidiMessage = vi.fn<(event: MIDIMessageEvent) => void>();
        getStateMock.mockReturnValue({ isSupported: false, inputs: [], selectedInputId: null });

        const result = await initWebMidi({ onMidiMessage });

        expect(result).toBe(false);
        expect(requestMidiAccessMock).not.toHaveBeenCalled();
    });

    it('should fall straight through to Tauri when Web MIDI is unavailable in navigator', async () => {
        const onMidiMessage = vi.fn<(event: MIDIMessageEvent) => void>();
        vi.stubGlobal('navigator', {/* no requestMIDIAccess */});
        vi.mocked(isTauri).mockReturnValue(true);
        vi.mocked(tauriInvoke).mockResolvedValue([{ index: 0, name: 'Tauri MIDI' }]);

        const result = await initWebMidi({ onMidiMessage });

        expect(result).toBe(true);
        expect(setTauriModeMock).toHaveBeenCalledWith(true);

        // restore navigator stub for subsequent tests
        vi.stubGlobal('navigator', { requestMIDIAccess: requestMidiAccessMock });
    });

    it('should return true with no input selection when Tauri lists zero devices', async () => {
        const onMidiMessage = vi.fn<(event: MIDIMessageEvent) => void>();
        requestMidiAccessMock.mockRejectedValue(new Error('no access'));
        vi.mocked(isTauri).mockReturnValue(true);
        vi.mocked(tauriInvoke).mockResolvedValue([]);

        const result = await initWebMidi({ onMidiMessage });

        expect(result).toBe(true);
        expect(setStateMock).toHaveBeenCalledWith({ inputs: [], isSupported: true });
        expect(selectMidiInputTauri).not.toHaveBeenCalled();
    });

    it('should report "Unknown Device" for an input whose name is null', async () => {
        const onMidiMessage = vi.fn<(event: MIDIMessageEvent) => void>();
        const input = { id: 'in-1', name: null };
        const mockAccess = {
            inputs: new Map([['in-1', input]]),
            onstatechange: null as (() => void) | null,
        };
        requestMidiAccessMock.mockResolvedValue(mockAccess);
        getMidiAccessMock.mockReturnValue(mockAccess);
        getStateMock.mockReturnValue({ isSupported: true, inputs: [], selectedInputId: null });

        await initWebMidi({ onMidiMessage });

        // enumerateInputs defaults a null name to "Unknown Device" and a missing
        // manufacturer to "Unknown". The inputs list is published via its own setState.
        expect(setStateMock).toHaveBeenCalledWith({
            inputs: [expect.objectContaining({ id: 'in-1', name: 'Unknown Device', manufacturer: 'Unknown' })],
        });
        expect(setStateMock).toHaveBeenCalledWith({ selectedInputId: 'in-1' });
    });

    it('should report unsupported and return false when the Tauri MIDI init throws', async () => {
        const onMidiMessage = vi.fn<(event: MIDIMessageEvent) => void>();
        requestMidiAccessMock.mockRejectedValue(new Error('no access'));
        vi.mocked(isTauri).mockReturnValue(true);
        vi.mocked(tauriInvoke).mockRejectedValue(new Error('tauri port closed'));

        const result = await initWebMidi({ onMidiMessage });

        expect(result).toBe(false);
        expect(setStateMock).toHaveBeenCalledWith({ isSupported: false });
    });
});
