import { beforeEach, describe, expect, it, vi } from 'vitest';

const getTauriModeMock = vi.hoisted(() => vi.fn<() => boolean>());
const getMidiAccessMock = vi.hoisted(() => vi.fn<() => { inputs: Map<string, unknown> } | null>());
const setStateMock = vi.hoisted(() => vi.fn<(next: Record<string, unknown>) => void>());
const attachInputMock = vi.hoisted(() => vi.fn());
const selectMidiInputTauriMock = vi.hoisted(() => vi.fn<() => Promise<void>>());
const loggerWarnMock = vi.hoisted(() => vi.fn());

vi.mock('../../getTauriMode', () => ({ getTauriMode: getTauriModeMock }));
vi.mock('../../getMidiAccess', () => ({ getMidiAccess: getMidiAccessMock }));
vi.mock('../../setState', () => ({ setState: setStateMock }));
vi.mock('../helpers', () => ({ attachInput: attachInputMock }));
vi.mock('../selectMidiInputTauri', () => ({ selectMidiInputTauri: selectMidiInputTauriMock }));
vi.mock('#/infra/logger/appLogger', () => ({ logger: { warn: loggerWarnMock, error: vi.fn(), info: vi.fn() } }));

import { selectMidiInput } from '../selectMidiInput';

const onMidiMessage = vi.fn<(event: MIDIMessageEvent) => void>();

describe('selectMidiInput', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getTauriModeMock.mockReturnValue(true);
        selectMidiInputTauriMock.mockResolvedValue(undefined);
    });

    it('opens the native port by index and commits the selection once it is open', async () => {
        selectMidiInput({ deviceId: '2', onMidiMessage });

        expect(selectMidiInputTauriMock).toHaveBeenCalledWith({ portIndex: 2, onMidiMessage });
        // Not yet — the port is still opening.
        expect(setStateMock).not.toHaveBeenCalled();

        await vi.waitFor(() => expect(setStateMock).toHaveBeenCalledWith({ selectedInputId: '2' }));
    });

    it('does not persist the selection when opening the native port fails', async () => {
        // An unplugged device or a refused permission rejects here. Committing
        // the id anyway leaves the picker — and localStorage — pointing at a
        // device that delivers no MIDI, with nothing reported.
        selectMidiInputTauriMock.mockRejectedValue(new Error('device not found'));

        selectMidiInput({ deviceId: '3', onMidiMessage });
        await vi.waitFor(() => expect(loggerWarnMock).toHaveBeenCalled());

        expect(setStateMock).not.toHaveBeenCalled();
        expect(loggerWarnMock).toHaveBeenCalledWith(
            '[MIDI] Failed to open MIDI input:',
            expect.objectContaining({ message: 'device not found' })
        );
    });

    it('attaches the Web MIDI input and commits the selection in browser mode', () => {
        const input = { id: 'in-1' };
        getTauriModeMock.mockReturnValue(false);
        getMidiAccessMock.mockReturnValue({ inputs: new Map([['in-1', input]]) });

        selectMidiInput({ deviceId: 'in-1', onMidiMessage });

        expect(attachInputMock).toHaveBeenCalledWith({ input, onMidiMessage });
        expect(setStateMock).toHaveBeenCalledWith({ selectedInputId: 'in-1' });
    });

    it('commits nothing when the requested Web MIDI input is not present', () => {
        getTauriModeMock.mockReturnValue(false);
        getMidiAccessMock.mockReturnValue({ inputs: new Map() });

        selectMidiInput({ deviceId: 'missing', onMidiMessage });

        expect(attachInputMock).not.toHaveBeenCalled();
        expect(setStateMock).not.toHaveBeenCalled();
    });
});
