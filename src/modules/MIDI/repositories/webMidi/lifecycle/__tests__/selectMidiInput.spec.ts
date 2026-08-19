import { beforeEach, describe, expect, it, vi } from 'vitest';

const getNativeModeMock = vi.hoisted(() => vi.fn<() => boolean>());
const getMidiAccessMock = vi.hoisted(() => vi.fn<() => { inputs: Map<string, unknown> } | null>());
const setStateMock = vi.hoisted(() => vi.fn<(next: Record<string, unknown>) => void>());
const attachInputMock = vi.hoisted(() => vi.fn());
const selectMidiInputNativeMock = vi.hoisted(() => vi.fn<() => Promise<void>>());
const listNativeMidiInputsMock = vi.hoisted(() =>
    vi.fn<() => Promise<{ id: string; name: string; portIndex: number }[]>>()
);
const loggerWarnMock = vi.hoisted(() => vi.fn());

vi.mock('../../getNativeMode', () => ({ getNativeMode: getNativeModeMock }));
vi.mock('../../getMidiAccess', () => ({ getMidiAccess: getMidiAccessMock }));
vi.mock('../../setState', () => ({ setState: setStateMock }));
vi.mock('../helpers', () => ({ attachInput: attachInputMock }));
vi.mock('../listNativeMidiInputs', () => ({ listNativeMidiInputs: listNativeMidiInputsMock }));
vi.mock('../selectMidiInputNative', () => ({ selectMidiInputNative: selectMidiInputNativeMock }));
vi.mock('#/infra/logger/appLogger', () => ({ logger: { warn: loggerWarnMock, error: vi.fn(), info: vi.fn() } }));

import { type WebMidiInputMessage } from '../../../../models/WebMidiTypes';
import { selectMidiInput } from '../selectMidiInput';

const onMidiMessage = vi.fn<(event: WebMidiInputMessage) => void>();

describe('selectMidiInput', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getNativeModeMock.mockReturnValue(true);
        selectMidiInputNativeMock.mockResolvedValue(undefined);
        listNativeMidiInputsMock.mockResolvedValue([{ id: 'Launchkey', name: 'Launchkey', portIndex: 2 }]);
    });

    it('opens the native port the id currently resolves to and commits the selection once it is open', async () => {
        selectMidiInput({ deviceId: 'Launchkey', onMidiMessage });

        // Not yet — the enumeration and the port are still in flight.
        expect(setStateMock).not.toHaveBeenCalled();

        await vi.waitFor(() => expect(setStateMock).toHaveBeenCalledWith({ selectedInputId: 'Launchkey' }));
        expect(selectMidiInputNativeMock).toHaveBeenCalledWith({ portIndex: 2, portName: 'Launchkey', onMidiMessage });
    });

    it('re-resolves the port index at select time rather than trusting the drawn list', async () => {
        // The picker was rendered before a replug moved the device; opening the
        // index it was drawn with would start a different instrument.
        listNativeMidiInputsMock.mockResolvedValue([
            { id: 'Launchkey', name: 'Launchkey', portIndex: 0 },
            { id: 'Built-in', name: 'Built-in', portIndex: 1 },
        ]);

        selectMidiInput({ deviceId: 'Built-in', onMidiMessage });

        await vi.waitFor(() =>
            expect(selectMidiInputNativeMock).toHaveBeenCalledWith({ portIndex: 1, portName: 'Built-in', onMidiMessage })
        );
    });

    it('commits nothing when the requested native port is no longer enumerated', async () => {
        listNativeMidiInputsMock.mockResolvedValue([{ id: 'Built-in', name: 'Built-in', portIndex: 0 }]);

        selectMidiInput({ deviceId: 'Launchkey', onMidiMessage });
        await vi.waitFor(() => expect(loggerWarnMock).toHaveBeenCalled());

        // Opening whatever port happens to be there instead is the misgrab the
        // stable id exists to prevent.
        expect(selectMidiInputNativeMock).not.toHaveBeenCalled();
        expect(setStateMock).not.toHaveBeenCalled();
    });

    it('does not persist the selection when opening the native port fails', async () => {
        // An unplugged device or a refused permission rejects here. Committing
        // the id anyway leaves the picker — and localStorage — pointing at a
        // device that delivers no MIDI, with nothing reported.
        selectMidiInputNativeMock.mockRejectedValue(new Error('device not found'));

        selectMidiInput({ deviceId: 'Launchkey', onMidiMessage });
        await vi.waitFor(() => expect(loggerWarnMock).toHaveBeenCalled());

        expect(setStateMock).not.toHaveBeenCalled();
        expect(loggerWarnMock).toHaveBeenCalledWith(
            '[MIDI] Failed to open MIDI input:',
            expect.objectContaining({ message: 'device not found' })
        );
    });

    it('attaches the Web MIDI input and commits the selection in browser mode', () => {
        const input = { id: 'in-1' };
        getNativeModeMock.mockReturnValue(false);
        getMidiAccessMock.mockReturnValue({ inputs: new Map([['in-1', input]]) });

        selectMidiInput({ deviceId: 'in-1', onMidiMessage });

        expect(attachInputMock).toHaveBeenCalledWith({ input, onMidiMessage });
        expect(setStateMock).toHaveBeenCalledWith({ selectedInputId: 'in-1' });
    });

    it('commits nothing when the requested Web MIDI input is not present', () => {
        getNativeModeMock.mockReturnValue(false);
        getMidiAccessMock.mockReturnValue({ inputs: new Map() });

        selectMidiInput({ deviceId: 'missing', onMidiMessage });

        expect(attachInputMock).not.toHaveBeenCalled();
        expect(setStateMock).not.toHaveBeenCalled();
    });
});
