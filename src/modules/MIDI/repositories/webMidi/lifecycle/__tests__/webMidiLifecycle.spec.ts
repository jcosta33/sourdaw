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
const setStateMock = vi.hoisted(() =>
    vi.fn<(next: Record<string, unknown>, options?: { persistSelection?: boolean }) => void>()
);
const readPersistedInputIdMock = vi.hoisted(() => vi.fn<() => string | null>(() => null));
const setTauriModeMock = vi.hoisted(() => vi.fn<(enabled: boolean) => void>());

// Must stub before importing the subject
vi.stubGlobal('navigator', {
    requestMIDIAccess: requestMidiAccessMock,
});

import { isTauri, tauriInvoke } from '#/utils/tauriBridge';

import { type WebMidiInputMessage } from '../../../../models/WebMidiTypes';
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
    // Forward the options argument only when the caller supplied one, so the
    // single-argument assertions below stay readable.
    setState: (next: Record<string, unknown>, options?: { persistSelection?: boolean }) => {
        if (options === undefined) {
            setStateMock(next);
            return;
        }
        setStateMock(next, options);
    },
}));

vi.mock('../../readPersistedInputId', () => ({
    readPersistedInputId: () => readPersistedInputIdMock(),
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
        readPersistedInputIdMock.mockReturnValue(null);
    });

    it('should initialize via Web MIDI if supported', async () => {
        const onMidiMessage = vi.fn<(event: WebMidiInputMessage) => void>();
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
        const onMidiMessage = vi.fn<(event: WebMidiInputMessage) => void>();
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

    it('rejects a malformed list_midi_inputs payload instead of opening a NaN port', async () => {
        // The payload crosses IPC, so it is untrusted. A bare cast turned a
        // missing `index` into `id: "undefined"` and then `Number(...)` -> NaN,
        // which was handed straight to `open_midi_input`.
        const onMidiMessage = vi.fn<(event: WebMidiInputMessage) => void>();
        requestMidiAccessMock.mockRejectedValue(new Error('no access'));
        vi.mocked(isTauri).mockReturnValue(true);
        vi.mocked(tauriInvoke).mockResolvedValue([{ name: 'Tauri MIDI' }]);

        const result = await initWebMidi({ onMidiMessage });

        expect(result).toBe(false);
        expect(selectMidiInputTauri).not.toHaveBeenCalled();
        expect(setStateMock).toHaveBeenCalledWith({ isSupported: false });
    });

    it('should return false if neither is supported', async () => {
        const onMidiMessage = vi.fn<(event: WebMidiInputMessage) => void>();
        requestMidiAccessMock.mockRejectedValue(new Error('no access'));
        vi.mocked(isTauri).mockReturnValue(false);

        const result = await initWebMidi({ onMidiMessage });

        expect(result).toBe(false);
        expect(setStateMock).toHaveBeenCalledWith({ isSupported: false });
    });

    it('should remove the active event listener when the selected input disappears', async () => {
        const onMidiMessage = vi.fn<(event: WebMidiInputMessage) => void>();
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
        const onMidiMessage = vi.fn<(event: WebMidiInputMessage) => void>();
        const input = { id: 'in-2', name: 'Keyboard' };
        const mockAccess = {
            inputs: new Map([['in-2', input]]),
            onstatechange: null as (() => void) | null,
        };
        requestMidiAccessMock.mockResolvedValue(mockAccess);
        getMidiAccessMock.mockReturnValue(mockAccess);
        getStateMock.mockReturnValue({ isSupported: true, inputs: [], selectedInputId: 'gone-input' });
        readPersistedInputIdMock.mockReturnValue('gone-input');
        vi.mocked(attachInput).mockClear();

        await initWebMidi({ onMidiMessage });
        mockAccess.onstatechange?.();

        expect(attachInput).toHaveBeenCalledWith({ input, onMidiMessage });
        expect(setStateMock).toHaveBeenCalledWith(
            {
                inputs: [expect.objectContaining({ id: 'in-2' })],
                selectedInputId: 'in-2',
            },
            { persistSelection: false }
        );
    });

    it('does not overwrite the saved device preference when the selected input is unplugged', async () => {
        // Unplugging a controller for a second used to rewrite localStorage to
        // whatever enumerated first, and replugging did not restore it.
        const onMidiMessage = vi.fn<(event: WebMidiInputMessage) => void>();
        const input = { id: 'in-2', name: 'Other Keyboard' };
        const mockAccess = {
            inputs: new Map([['in-2', input]]),
            onstatechange: null as (() => void) | null,
        };
        requestMidiAccessMock.mockResolvedValue(mockAccess);
        getMidiAccessMock.mockReturnValue(mockAccess);
        getStateMock.mockReturnValue({ isSupported: true, inputs: [], selectedInputId: 'preferred-input' });
        readPersistedInputIdMock.mockReturnValue('preferred-input');

        await initWebMidi({ onMidiMessage });
        setStateMock.mockClear();
        mockAccess.onstatechange?.();

        const persistedSelectionWrites = setStateMock.mock.calls.filter(
            ([next, options]) => 'selectedInputId' in next && options?.persistSelection !== false
        );
        expect(persistedSelectionWrites).toEqual([]);
    });

    it('restores the saved device when it reappears after a replug', async () => {
        const onMidiMessage = vi.fn<(event: WebMidiInputMessage) => void>();
        const preferred = { id: 'preferred-input', name: 'Keyboard' };
        const standIn = { id: 'in-2', name: 'Other Keyboard' };
        const mockAccess = {
            inputs: new Map<string, unknown>([['in-2', standIn]]),
            onstatechange: null as (() => void) | null,
        };
        requestMidiAccessMock.mockResolvedValue(mockAccess);
        getMidiAccessMock.mockReturnValue(mockAccess);
        // The session has fallen back to the stand-in; the saved preference is
        // still the device that was unplugged.
        getStateMock.mockReturnValue({ isSupported: true, inputs: [], selectedInputId: 'in-2' });
        readPersistedInputIdMock.mockReturnValue('preferred-input');

        await initWebMidi({ onMidiMessage });
        vi.mocked(attachInput).mockClear();
        setStateMock.mockClear();

        // The preferred device comes back.
        mockAccess.inputs.set('preferred-input', preferred);
        mockAccess.onstatechange?.();

        expect(attachInput).toHaveBeenCalledWith({ input: preferred, onMidiMessage });
        // No `persistSelection: false` — restoring the saved device is a
        // legitimate write of the preference back to itself.
        expect(setStateMock).toHaveBeenCalledWith(expect.objectContaining({ selectedInputId: 'preferred-input' }));
    });

    it('should keep the selected input attached when it still exists on state change', async () => {
        const onMidiMessage = vi.fn<(event: WebMidiInputMessage) => void>();
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
        // The selection is unchanged, so this is a no-op re-statement rather
        // than a user choice: it must not rewrite the stored preference.
        expect(setStateMock).toHaveBeenLastCalledWith(
            {
                inputs: [expect.objectContaining({ id: 'in-1' })],
                selectedInputId: 'in-1',
            },
            { persistSelection: false }
        );
    });

    it('should return false and warn when MIDI is reported unsupported', async () => {
        const onMidiMessage = vi.fn<(event: WebMidiInputMessage) => void>();
        getStateMock.mockReturnValue({ isSupported: false, inputs: [], selectedInputId: null });

        const result = await initWebMidi({ onMidiMessage });

        expect(result).toBe(false);
        expect(requestMidiAccessMock).not.toHaveBeenCalled();
    });

    it('should fall straight through to Tauri when Web MIDI is unavailable in navigator', async () => {
        const onMidiMessage = vi.fn<(event: WebMidiInputMessage) => void>();
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
        const onMidiMessage = vi.fn<(event: WebMidiInputMessage) => void>();
        requestMidiAccessMock.mockRejectedValue(new Error('no access'));
        vi.mocked(isTauri).mockReturnValue(true);
        vi.mocked(tauriInvoke).mockResolvedValue([]);

        const result = await initWebMidi({ onMidiMessage });

        expect(result).toBe(true);
        expect(setStateMock).toHaveBeenCalledWith({ inputs: [], isSupported: true });
        expect(selectMidiInputTauri).not.toHaveBeenCalled();
    });

    it('should report "Unknown Device" for an input whose name is null', async () => {
        const onMidiMessage = vi.fn<(event: WebMidiInputMessage) => void>();
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
        const onMidiMessage = vi.fn<(event: WebMidiInputMessage) => void>();
        requestMidiAccessMock.mockRejectedValue(new Error('no access'));
        vi.mocked(isTauri).mockReturnValue(true);
        vi.mocked(tauriInvoke).mockRejectedValue(new Error('tauri port closed'));

        const result = await initWebMidi({ onMidiMessage });

        expect(result).toBe(false);
        expect(setStateMock).toHaveBeenCalledWith({ isSupported: false });
    });
});
