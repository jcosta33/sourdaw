import { beforeEach, describe, expect, it, vi } from 'vitest';

type PortsChangedListener = (envelope: { event: string; payload: unknown }) => void;

const desktopInvokeMock = vi.hoisted(() => vi.fn<(command: string) => Promise<unknown>>());
const desktopListenMock = vi.hoisted(() =>
    vi.fn<(event: string, handler: PortsChangedListener) => Promise<() => void>>()
);
const detachActiveInputMock = vi.hoisted(() => vi.fn());
const getStateMock = vi.hoisted(() =>
    vi.fn(() => ({
        isSupported: true,
        inputs: [] as unknown[],
        selectedInputId: null as string | null,
        enumerationError: null as string | null,
    }))
);
const persistInputIdMock = vi.hoisted(() => vi.fn<(id: string | null, scheme: string) => void>());
const readPersistedInputIdMock = vi.hoisted(() => vi.fn<() => string | null>(() => null));
const selectMidiInputNativeMock = vi.hoisted(() => vi.fn<() => Promise<void>>().mockResolvedValue(undefined));
const setNativeModeMock = vi.hoisted(() => vi.fn<(enabled: boolean) => void>());
const setStateMock = vi.hoisted(() =>
    vi.fn<(next: Record<string, unknown>, options?: { persistSelection?: boolean; identityScheme?: string }) => void>()
);

vi.mock('#/utils/desktopBridge', () => ({
    isDesktopRuntime: () => true,
    desktopInvoke: desktopInvokeMock,
    desktopListen: desktopListenMock,
}));

vi.mock('../detachActiveInput', () => ({
    detachActiveInput: detachActiveInputMock,
}));

vi.mock('../../getState', () => ({
    getState: () => getStateMock(),
}));

vi.mock('../../persistInputId', () => ({
    persistInputId: persistInputIdMock,
}));

vi.mock('../../readPersistedInputId', () => ({
    readPersistedInputId: () => readPersistedInputIdMock(),
}));

vi.mock('../../setNativeMode', () => ({
    setNativeMode: (enabled: boolean) => setNativeModeMock(enabled),
}));

vi.mock('../../setState', () => ({
    // Forward the options argument only when the caller supplied one, so the
    // persistSelection assertions stay readable.
    setState: (next: Record<string, unknown>, options?: { persistSelection?: boolean; identityScheme?: string }) => {
        if (options === undefined) {
            setStateMock(next);
            return;
        }
        setStateMock(next, options);
    },
}));

vi.mock('../helpers', () => ({
    attachInput: vi.fn(),
}));

vi.mock('../selectMidiInputNative', () => ({
    selectMidiInputNative: (...args: Parameters<typeof selectMidiInputNativeMock>) =>
        selectMidiInputNativeMock(...args),
}));

import { type WebMidiInputMessage } from '../../../../models/WebMidiTypes';
import { initWebMidi } from '../initWebMidi';

const onMidiMessage = vi.fn<(event: WebMidiInputMessage) => void>();

/** The ports-changed listener initWebMidi registers on the native path. */
function registeredPortsChangedListener(): PortsChangedListener {
    const registration = desktopListenMock.mock.calls.find(([event]) => event === 'midi-ports-changed');
    if (!registration) {
        throw new Error('initWebMidi never registered the midi-ports-changed listener');
    }
    return registration[1];
}

describe('native midi-ports-changed handling', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        desktopListenMock.mockResolvedValue(() => {});
        selectMidiInputNativeMock.mockResolvedValue(undefined);
        readPersistedInputIdMock.mockReturnValue(null);
        getStateMock.mockReturnValue({
            isSupported: true,
            inputs: [],
            selectedInputId: null,
            enumerationError: null,
        });
    });

    it('re-opens the preferred device through the select sequence when it comes back', async () => {
        // Started with the preferred Launchkey unplugged: init opened the
        // Built-in as a stand-in and left the preference alone.
        desktopInvokeMock.mockResolvedValue([{ index: 0, id: '300', name: 'Built-in' }]);
        readPersistedInputIdMock.mockReturnValue('2001');
        getStateMock.mockReturnValue({
            isSupported: true,
            inputs: [],
            selectedInputId: '300',
            enumerationError: null,
        });
        await initWebMidi({ onMidiMessage });

        // The Launchkey returns.
        desktopInvokeMock.mockResolvedValue([
            { index: 0, id: '300', name: 'Built-in' },
            { index: 1, id: '2001', name: 'Launchkey' },
        ]);
        registeredPortsChangedListener()({ event: 'midi-ports-changed', payload: null });

        await vi.waitFor(() => {
            expect(selectMidiInputNativeMock).toHaveBeenLastCalledWith({
                portIndex: 1,
                portName: 'Launchkey',
                onMidiMessage,
            });
        });
    });

    it('falls back to the first port as a session stand-in when the selected device is gone', async () => {
        // Started with the Launchkey present and selected.
        desktopInvokeMock.mockResolvedValue([{ index: 0, id: '2001', name: 'Launchkey' }]);
        readPersistedInputIdMock.mockReturnValue('2001');
        await initWebMidi({ onMidiMessage });

        // The Launchkey disappears; only the Built-in remains.
        desktopInvokeMock.mockResolvedValue([{ index: 0, id: '300', name: 'Built-in' }]);
        registeredPortsChangedListener()({ event: 'midi-ports-changed', payload: null });

        await vi.waitFor(() => {
            expect(selectMidiInputNativeMock).toHaveBeenLastCalledWith({
                portIndex: 0,
                portName: 'Built-in',
                onMidiMessage,
            });
        });
        // Session-only stand-in: the unplugged device keeps the preference.
        expect(setStateMock).toHaveBeenCalledWith(expect.objectContaining({ selectedInputId: '300' }), {
            persistSelection: false,
        });
        expect(persistInputIdMock).not.toHaveBeenCalled();
    });

    it('detaches the dead input and clears the selection when every port is gone', async () => {
        desktopInvokeMock.mockResolvedValue([{ index: 0, id: '2001', name: 'Launchkey' }]);
        readPersistedInputIdMock.mockReturnValue('2001');
        await initWebMidi({ onMidiMessage });

        desktopInvokeMock.mockResolvedValue([]);
        registeredPortsChangedListener()({ event: 'midi-ports-changed', payload: null });

        await vi.waitFor(() => {
            expect(detachActiveInputMock).toHaveBeenCalled();
        });
        expect(selectMidiInputNativeMock).toHaveBeenCalledTimes(1); // init's own open only
        expect(setStateMock).toHaveBeenCalledWith(expect.objectContaining({ inputs: [], selectedInputId: null }), {
            persistSelection: false,
        });
    });

    it('re-enumerates on receipt instead of trusting a payload', async () => {
        // The event is a tick: whatever it carries must not become the port list.
        desktopInvokeMock.mockResolvedValue([{ index: 0, id: '300', name: 'Built-in' }]);
        await initWebMidi({ onMidiMessage });

        desktopInvokeMock.mockClear();
        desktopInvokeMock.mockResolvedValue([{ index: 0, id: '300', name: 'Built-in' }]);
        registeredPortsChangedListener()({ event: 'midi-ports-changed', payload: { ports: [] } });

        await vi.waitFor(() => {
            expect(desktopInvokeMock).toHaveBeenCalledWith('list_midi_inputs');
        });
        expect(setStateMock).toHaveBeenCalledWith(
            expect.objectContaining({ inputs: [{ id: '300', name: 'Built-in', manufacturer: 'System' }] })
        );
    });
});
