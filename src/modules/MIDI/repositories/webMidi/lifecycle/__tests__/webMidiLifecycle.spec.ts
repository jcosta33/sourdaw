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
const setNativeModeMock = vi.hoisted(() => vi.fn<(enabled: boolean) => void>());

// Must stub before importing the subject
vi.stubGlobal('navigator', {
    requestMIDIAccess: requestMidiAccessMock,
});

import { isDesktopRuntime, desktopInvoke } from '#/utils/desktopBridge';

import { type WebMidiInputMessage } from '../../../../models/WebMidiTypes';
import { webMidiRuntime } from '../../state';
import { attachInput } from '../helpers';
import { initWebMidi } from '../initWebMidi';
import { selectMidiInputNative } from '../selectMidiInputNative';

vi.mock('#/utils/desktopBridge', () => ({
    isDesktopRuntime: vi.fn(),
    desktopInvoke: vi.fn(),
    desktopListen: vi.fn().mockResolvedValue(() => {}),
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

vi.mock('../../setNativeMode', () => ({
    setNativeMode: (enabled: boolean) => setNativeModeMock(enabled),
}));

vi.mock('../helpers', () => ({
    attachInput: vi.fn(),
}));

vi.mock('../selectMidiInputNative', () => ({
    selectMidiInputNative: vi.fn(),
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

    it('does not overwrite the saved preference when starting up with that device unplugged', async () => {
        // The saved id seeds `selectedInputId`, so the startup attach resolves
        // it, misses, and falls back to whatever enumerates first. Persisting
        // that stand-in rebinds the controller permanently — and the replug
        // restore above can never undo it, because it only fires while the
        // saved id differs from the selected one.
        const onMidiMessage = vi.fn<(event: WebMidiInputMessage) => void>();
        const standIn = { id: 'built-in', name: 'Built-in' };
        const mockAccess = { inputs: new Map([['built-in', standIn]]), onstatechange: null };
        requestMidiAccessMock.mockResolvedValue(mockAccess);
        getMidiAccessMock.mockReturnValue(mockAccess);
        getStateMock.mockReturnValue({ isSupported: true, inputs: [], selectedInputId: 'launchkey' });
        readPersistedInputIdMock.mockReturnValue('launchkey');

        await initWebMidi({ onMidiMessage });

        const persistedSelectionWrites = setStateMock.mock.calls.filter(
            ([next, options]) => 'selectedInputId' in next && options?.persistSelection !== false
        );
        expect(persistedSelectionWrites).toEqual([]);
        expect(attachInput).toHaveBeenCalledWith({ input: standIn, onMidiMessage });
    });

    it('attaches the saved device without rewriting the preference it came from', async () => {
        // Init never persists: whatever it resolves is either the saved device
        // (already remembered) or a stand-in (must not be). Only an explicit
        // selection writes the preference.
        const onMidiMessage = vi.fn<(event: WebMidiInputMessage) => void>();
        const input = { id: 'launchkey', name: 'Launchkey' };
        const mockAccess = { inputs: new Map([['launchkey', input]]), onstatechange: null };
        requestMidiAccessMock.mockResolvedValue(mockAccess);
        getMidiAccessMock.mockReturnValue(mockAccess);
        getStateMock.mockReturnValue({ isSupported: true, inputs: [], selectedInputId: 'launchkey' });
        readPersistedInputIdMock.mockReturnValue('launchkey');

        await initWebMidi({ onMidiMessage });

        expect(attachInput).toHaveBeenCalledWith({ input, onMidiMessage });
        expect(setStateMock).toHaveBeenCalledWith({ selectedInputId: 'launchkey' }, { persistSelection: false });
    });

    it('does not adopt an earlier fallback as the preference on a second init', async () => {
        // Boot with the saved device unplugged: init falls back to the
        // built-in and writes it into live session state. The picker mounting
        // (or Refresh) runs init again, which now reads that stand-in out of
        // live state. Resolving the target from live state instead of the
        // saved preference persisted the stand-in here — permanently
        // overwriting the user's device with one they never chose.
        const onMidiMessage = vi.fn<(event: WebMidiInputMessage) => void>();
        const standIn = { id: 'built-in', name: 'Built-in' };
        const mockAccess = { inputs: new Map([['built-in', standIn]]), onstatechange: null };
        requestMidiAccessMock.mockResolvedValue(mockAccess);
        getMidiAccessMock.mockReturnValue(mockAccess);
        readPersistedInputIdMock.mockReturnValue('launchkey');

        getStateMock.mockReturnValue({ isSupported: true, inputs: [], selectedInputId: 'launchkey' });
        await initWebMidi({ onMidiMessage });

        // Second init sees the stand-in as the live selection.
        getStateMock.mockReturnValue({ isSupported: true, inputs: [], selectedInputId: 'built-in' });
        await initWebMidi({ onMidiMessage });

        const persistedSelectionWrites = setStateMock.mock.calls.filter(
            ([next, options]) => 'selectedInputId' in next && options?.persistSelection !== false
        );
        expect(persistedSelectionWrites).toEqual([]);
    });

    it('should fallback to the native bridge if Web MIDI fails', async () => {
        const onMidiMessage = vi.fn<(event: WebMidiInputMessage) => void>();
        // Force failure of browser MIDI
        requestMidiAccessMock.mockRejectedValue(new Error('no access'));
        vi.mocked(isDesktopRuntime).mockReturnValue(true);
        vi.mocked(desktopInvoke).mockResolvedValue([{ index: 0, name: 'Native MIDI' }]);

        const result = await initWebMidi({ onMidiMessage });

        expect(result).toBe(true);
        expect(setNativeModeMock).toHaveBeenCalledWith(true);
        expect(desktopInvoke).toHaveBeenCalledWith('list_midi_inputs');
        expect(selectMidiInputNative).toHaveBeenCalledWith({ portIndex: 0, portName: 'Native MIDI', onMidiMessage });
    });

    it('rejects a malformed list_midi_inputs payload instead of opening a NaN port', async () => {
        // The payload crosses IPC, so it is untrusted. A bare cast turned a
        // missing `index` into `id: "undefined"` and then `Number(...)` -> NaN,
        // which was handed straight to `open_midi_input`.
        const onMidiMessage = vi.fn<(event: WebMidiInputMessage) => void>();
        requestMidiAccessMock.mockRejectedValue(new Error('no access'));
        vi.mocked(isDesktopRuntime).mockReturnValue(true);
        vi.mocked(desktopInvoke).mockResolvedValue([{ name: 'Native MIDI' }]);

        const result = await initWebMidi({ onMidiMessage });

        expect(result).toBe(false);
        expect(selectMidiInputNative).not.toHaveBeenCalled();
        expect(setStateMock).toHaveBeenCalledWith({ isSupported: false });
    });

    it('should return false if neither is supported', async () => {
        const onMidiMessage = vi.fn<(event: WebMidiInputMessage) => void>();
        requestMidiAccessMock.mockRejectedValue(new Error('no access'));
        vi.mocked(isDesktopRuntime).mockReturnValue(false);

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

    it('should fall straight through to the native bridge when Web MIDI is unavailable in navigator', async () => {
        const onMidiMessage = vi.fn<(event: WebMidiInputMessage) => void>();
        vi.stubGlobal('navigator', {/* no requestMIDIAccess */});
        vi.mocked(isDesktopRuntime).mockReturnValue(true);
        vi.mocked(desktopInvoke).mockResolvedValue([{ index: 0, name: 'Native MIDI' }]);

        const result = await initWebMidi({ onMidiMessage });

        expect(result).toBe(true);
        expect(setNativeModeMock).toHaveBeenCalledWith(true);

        // restore navigator stub for subsequent tests
        vi.stubGlobal('navigator', { requestMIDIAccess: requestMidiAccessMock });
    });

    it('should return true with no input selection when the native bridge lists zero devices', async () => {
        const onMidiMessage = vi.fn<(event: WebMidiInputMessage) => void>();
        requestMidiAccessMock.mockRejectedValue(new Error('no access'));
        vi.mocked(isDesktopRuntime).mockReturnValue(true);
        vi.mocked(desktopInvoke).mockResolvedValue([]);

        const result = await initWebMidi({ onMidiMessage });

        expect(result).toBe(true);
        expect(setStateMock).toHaveBeenCalledWith({ inputs: [], isSupported: true });
        expect(selectMidiInputNative).not.toHaveBeenCalled();
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
        // Init resolves and attaches, but never writes the preference.
        expect(setStateMock).toHaveBeenCalledWith({ selectedInputId: 'in-1' }, { persistSelection: false });
    });

    it('does not overwrite the saved preference on the native path either', async () => {
        // Native ports are indices, so a device list that shifted by one port
        // rebinds the saved preference to a different instrument entirely.
        const onMidiMessage = vi.fn<(event: WebMidiInputMessage) => void>();
        requestMidiAccessMock.mockRejectedValue(new Error('no access'));
        vi.mocked(isDesktopRuntime).mockReturnValue(true);
        vi.mocked(desktopInvoke).mockResolvedValue([{ index: 0, name: 'Built-in' }]);
        getStateMock.mockReturnValue({ isSupported: true, inputs: [], selectedInputId: '3' });
        readPersistedInputIdMock.mockReturnValue('3');

        await initWebMidi({ onMidiMessage });

        const persistedSelectionWrites = setStateMock.mock.calls.filter(
            ([next, options]) => 'selectedInputId' in next && options?.persistSelection !== false
        );
        expect(persistedSelectionWrites).toEqual([]);
        expect(selectMidiInputNative).toHaveBeenCalledWith({ portIndex: 0, portName: 'Built-in', onMidiMessage });
    });

    it('re-opens the saved native device after the enumeration order changes', async () => {
        // Replugs, hub power cycles and reboots reorder midir's port list. A
        // preference keyed on the position resolves to whichever instrument
        // now holds it; keyed on the port name it follows the device.
        const onMidiMessage = vi.fn<(event: WebMidiInputMessage) => void>();
        requestMidiAccessMock.mockRejectedValue(new Error('no access'));
        vi.mocked(isDesktopRuntime).mockReturnValue(true);
        vi.mocked(desktopInvoke).mockResolvedValue([
            { index: 0, name: 'Built-in' },
            { index: 1, name: 'Launchkey' },
        ]);
        getStateMock.mockReturnValue({ isSupported: true, inputs: [], selectedInputId: 'Launchkey' });
        readPersistedInputIdMock.mockReturnValue('Launchkey');

        await initWebMidi({ onMidiMessage });

        expect(selectMidiInputNative).toHaveBeenCalledWith({ portIndex: 1, portName: 'Launchkey', onMidiMessage });
        expect(setStateMock).toHaveBeenCalledWith({ selectedInputId: 'Launchkey' }, { persistSelection: false });
    });

    it('treats a persisted enumeration index as absent instead of grabbing that port', async () => {
        // Ids persisted before identity moved off the index are bare numbers.
        // Resolving one against the current list would hand the user a device
        // they never chose; it has to degrade to no saved selection.
        const onMidiMessage = vi.fn<(event: WebMidiInputMessage) => void>();
        requestMidiAccessMock.mockRejectedValue(new Error('no access'));
        vi.mocked(isDesktopRuntime).mockReturnValue(true);
        vi.mocked(desktopInvoke).mockResolvedValue([
            { index: 0, name: 'Built-in' },
            { index: 1, name: 'Launchkey' },
        ]);
        getStateMock.mockReturnValue({ isSupported: true, inputs: [], selectedInputId: '1' });
        readPersistedInputIdMock.mockReturnValue('1');

        await initWebMidi({ onMidiMessage });

        expect(selectMidiInputNative).toHaveBeenCalledWith({ portIndex: 0, portName: 'Built-in', onMidiMessage });
        const persistedSelectionWrites = setStateMock.mock.calls.filter(
            ([next, options]) => 'selectedInputId' in next && options?.persistSelection !== false
        );
        expect(persistedSelectionWrites).toEqual([]);
    });

    it('keeps MIDI alive when the startup port refuses to open', async () => {
        // The enumeration succeeded and was published; one port failing to
        // open must not flip the whole surface to unsupported — that renders
        // "MIDI not supported" with no Refresh button and no recovery short of
        // an app restart.
        const onMidiMessage = vi.fn<(event: WebMidiInputMessage) => void>();
        requestMidiAccessMock.mockRejectedValue(new Error('no access'));
        vi.mocked(isDesktopRuntime).mockReturnValue(true);
        vi.mocked(desktopInvoke).mockResolvedValue([{ index: 0, name: 'Built-in' }]);
        vi.mocked(selectMidiInputNative).mockRejectedValueOnce(new Error('device busy'));

        const result = await initWebMidi({ onMidiMessage });

        expect(result).toBe(true);
        expect(setStateMock).not.toHaveBeenCalledWith({ isSupported: false });
        expect(setStateMock).toHaveBeenCalledWith(
            expect.objectContaining({ isSupported: true, inputs: [expect.objectContaining({ id: 'Built-in' })] })
        );
    });

    it('publishes native inputs under their stable ids', async () => {
        const onMidiMessage = vi.fn<(event: WebMidiInputMessage) => void>();
        requestMidiAccessMock.mockRejectedValue(new Error('no access'));
        vi.mocked(isDesktopRuntime).mockReturnValue(true);
        vi.mocked(desktopInvoke).mockResolvedValue([
            { index: 0, name: 'MPK Mini' },
            { index: 1, name: 'MPK Mini' },
        ]);

        await initWebMidi({ onMidiMessage });

        expect(setStateMock).toHaveBeenCalledWith({
            inputs: [
                { id: 'MPK Mini #0', name: 'MPK Mini', manufacturer: 'System' },
                { id: 'MPK Mini #1', name: 'MPK Mini', manufacturer: 'System' },
            ],
            isSupported: true,
        });
    });

    it('should report unsupported and return false when the native MIDI init throws', async () => {
        const onMidiMessage = vi.fn<(event: WebMidiInputMessage) => void>();
        requestMidiAccessMock.mockRejectedValue(new Error('no access'));
        vi.mocked(isDesktopRuntime).mockReturnValue(true);
        vi.mocked(desktopInvoke).mockRejectedValue(new Error('native port closed'));

        const result = await initWebMidi({ onMidiMessage });

        expect(result).toBe(false);
        expect(setStateMock).toHaveBeenCalledWith({ isSupported: false });
    });
});
