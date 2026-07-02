import { beforeEach, describe, expect, it, vi } from 'vitest';

const getTauriEventUnlistenMock = vi.hoisted(() => vi.fn<(() => void) | null, []>());
const onMidiMessageMock = vi.hoisted(() => vi.fn<void, [MIDIMessageEvent]>());
const setTauriEventUnlistenMock = vi.hoisted(() => vi.fn<void, [(() => void) | null]>());
const tauriInvokeMock = vi.hoisted(() => vi.fn<Promise<unknown>, [string, Record<string, unknown>?]>());
const tauriListenMock = vi.hoisted(() => vi.fn<Promise<() => void>, [string, (event: unknown) => void]>());

vi.mock('#/utils/tauriBridge', () => ({
    tauriInvoke: tauriInvokeMock,
    tauriListen: tauriListenMock,
}));

vi.mock('../../messageHandlers', () => ({
    onMidiMessage: onMidiMessageMock,
}));

vi.mock('../../getTauriEventUnlisten', () => ({
    getTauriEventUnlisten: () => getTauriEventUnlistenMock(),
}));

vi.mock('../../setTauriEventUnlisten', () => ({
    setTauriEventUnlisten: (unlisten: (() => void) | null) => setTauriEventUnlistenMock(unlisten),
}));

import { selectMidiInputTauri } from '../selectMidiInputTauri';

describe('selectMidiInputTauri', () => {
    const newUnlisten = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        getTauriEventUnlistenMock.mockReturnValue(null);
        tauriInvokeMock.mockResolvedValue(undefined);
        tauriListenMock.mockResolvedValue(newUnlisten);
    });

    it('should close any previous Tauri listener before opening the selected MIDI input', async () => {
        const previousUnlisten = vi.fn();
        getTauriEventUnlistenMock.mockReturnValue(previousUnlisten);

        await selectMidiInputTauri(2);

        expect(previousUnlisten).toHaveBeenCalledTimes(1);
        expect(setTauriEventUnlistenMock).toHaveBeenNthCalledWith(1, null);
        expect(tauriInvokeMock).toHaveBeenCalledWith('open_midi_input', { portIndex: 2 });
        expect(tauriListenMock).toHaveBeenCalledWith('midi-message', expect.any(Function));
        expect(setTauriEventUnlistenMock).toHaveBeenNthCalledWith(2, newUnlisten);
    });

    it('should forward valid Tauri MIDI message bytes to the MIDI handler', async () => {
        await selectMidiInputTauri(1);

        const listener = tauriListenMock.mock.calls[0]![1];
        listener({ payload: { data: [144, 64, 127] } });

        expect(onMidiMessageMock).toHaveBeenCalledTimes(1);
        expect(onMidiMessageMock.mock.calls[0]![0].data).toEqual(new Uint8Array([144, 64, 127]));
    });

    it('should not forward malformed Tauri MIDI message payloads', async () => {
        await selectMidiInputTauri(1);

        const listener = tauriListenMock.mock.calls[0]![1];
        listener({});
        listener({ payload: {} });
        listener({ payload: { data: '144,64,127' } });
        listener({ payload: { data: [144] } });

        expect(onMidiMessageMock).not.toHaveBeenCalled();
    });
});
