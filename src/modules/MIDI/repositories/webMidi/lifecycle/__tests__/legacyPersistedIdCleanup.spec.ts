import { beforeEach, describe, expect, it, vi } from 'vitest';

type PortsChangedListener = (envelope: { event: string; payload: unknown }) => void;

const desktopInvokeMock = vi.hoisted(() => vi.fn<(command: string) => Promise<unknown>>());
const desktopListenMock = vi.hoisted(() =>
    vi.fn<(event: string, handler: PortsChangedListener) => Promise<() => void>>()
);
const persistInputIdMock = vi.hoisted(() => vi.fn<(id: string | null, scheme: string) => void>());
const readPersistedInputIdMock = vi.hoisted(() => vi.fn<() => string | null>(() => null));
const selectMidiInputNativeMock = vi.hoisted(() => vi.fn<() => Promise<void>>().mockResolvedValue(undefined));
const setStateMock = vi.hoisted(() =>
    vi.fn<(next: Record<string, unknown>, options?: { persistSelection?: boolean; identityScheme?: string }) => void>()
);

vi.mock('#/utils/desktopBridge', () => ({
    isDesktopRuntime: () => true,
    desktopInvoke: desktopInvokeMock,
    desktopListen: desktopListenMock,
}));

vi.mock('../../persistInputId', () => ({
    persistInputId: persistInputIdMock,
}));

vi.mock('../../readPersistedInputId', () => ({
    readPersistedInputId: () => readPersistedInputIdMock(),
}));

vi.mock('../../setState', () => ({
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

import { NATIVE_IDENTITY_SCHEME } from '../../selectedInputIdStorageKeys';
import { initWebMidi } from '../initWebMidi';

describe('legacy persisted-id cleanup on native init', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        desktopListenMock.mockResolvedValue(() => {});
        selectMidiInputNativeMock.mockResolvedValue(undefined);
        readPersistedInputIdMock.mockReturnValue(null);
    });

    it('replaces a dead all-digits id with the resolved fallback in exactly one write', async () => {
        // "2" was an enumeration index when it was persisted; under stable
        // identity it resolves to nothing and would stay dead on every launch.
        desktopInvokeMock.mockResolvedValue([
            { index: 0, id: '300', name: 'Built-in' },
            { index: 1, id: '2001', name: 'Launchkey' },
        ]);
        readPersistedInputIdMock.mockReturnValue('2');

        await initWebMidi({ onMidiMessage: () => {} });

        expect(persistInputIdMock).toHaveBeenCalledTimes(1);
        // The settle writes the native scheme's key only — never an untagged
        // or Web-MIDI-namespaced one (#4138).
        expect(persistInputIdMock).toHaveBeenCalledWith('300', NATIVE_IDENTITY_SCHEME);
        // The fallback port is what init opened.
        expect(selectMidiInputNativeMock).toHaveBeenCalledWith({
            portIndex: 0,
            portName: 'Built-in',
            onMidiMessage: expect.any(Function),
        });
    });

    it('leaves a persisted name id that still resolves alone', async () => {
        desktopInvokeMock.mockResolvedValue([
            { index: 0, id: '300', name: 'Built-in' },
            { index: 1, id: '2001', name: 'Launchkey' },
        ]);
        readPersistedInputIdMock.mockReturnValue('2001');

        await initWebMidi({ onMidiMessage: () => {} });

        expect(persistInputIdMock).not.toHaveBeenCalled();
        expect(selectMidiInputNativeMock).toHaveBeenCalledWith({
            portIndex: 1,
            portName: 'Launchkey',
            onMidiMessage: expect.any(Function),
        });
    });

    it('leaves an all-digits id that exactly matches a real port id alone', async () => {
        // On macOS the stable ids are CoreMIDI unique ids — also all digits.
        // A legacy "2" that binds to a real port is not dead and must not be
        // discarded by a rule that cannot tell digits from digits.
        desktopInvokeMock.mockResolvedValue([
            { index: 0, id: '2', name: 'MPK Mini' },
            { index: 1, id: '300', name: 'Built-in' },
        ]);
        readPersistedInputIdMock.mockReturnValue('2');

        await initWebMidi({ onMidiMessage: () => {} });

        expect(persistInputIdMock).not.toHaveBeenCalled();
        expect(selectMidiInputNativeMock).toHaveBeenCalledWith({
            portIndex: 0,
            portName: 'MPK Mini',
            onMidiMessage: expect.any(Function),
        });
    });

    it('leaves a non-digit id whose device is merely unplugged alone', async () => {
        // The dead-value settle is only for digits: an unresolved name still
        // means the same device may return, and init must not overwrite the
        // preference with a stand-in.
        desktopInvokeMock.mockResolvedValue([{ index: 0, id: '300', name: 'Built-in' }]);
        readPersistedInputIdMock.mockReturnValue('Launchkey 49');

        await initWebMidi({ onMidiMessage: () => {} });

        expect(persistInputIdMock).not.toHaveBeenCalled();
        expect(selectMidiInputNativeMock).toHaveBeenCalledWith({
            portIndex: 0,
            portName: 'Built-in',
            onMidiMessage: expect.any(Function),
        });
    });
});
