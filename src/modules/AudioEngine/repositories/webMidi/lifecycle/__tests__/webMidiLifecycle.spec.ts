import { vi, describe, it, expect, beforeEach } from 'vitest';

const getMidiAccessMock = vi.hoisted(() => vi.fn<unknown, []>());
const getActiveInputMock = vi.hoisted(() => vi.fn<MIDIInput | null, []>());
const getStateMock = vi.hoisted(() => vi.fn(() => ({ isSupported: true, inputs: [], selectedInputId: null })));
const requestMidiAccessMock = vi.hoisted(() => vi.fn<Promise<unknown>, []>());
const setActiveInputMock = vi.hoisted(() => vi.fn<void, [MIDIInput | null]>());
const setMidiAccessMock = vi.hoisted(() => vi.fn<void, [MIDIAccess]>());
const setStateMock = vi.hoisted(() => vi.fn<void, [Record<string, unknown>]>());
const setTargetTrackIdMock = vi.hoisted(() => vi.fn<void, [string | null]>());
const setTauriModeMock = vi.hoisted(() => vi.fn<void, [boolean]>());

// Must stub before importing the subject
vi.stubGlobal('navigator', {
    requestMIDIAccess: requestMidiAccessMock,
});

import { Container } from '#/infra/di/Container';
import { trackStore } from '#/modules/Arrangement/stores';
import { isTauri, tauriInvoke } from '#/utils/tauriBridge';

import { setWebMidiEventBus } from '../../webMidiEventBus';
import { attachInput } from '../helpers';
import { initWebMidi } from '../initWebMidi';
import { selectMidiInputTauri } from '../selectMidiInputTauri';

type InitWebMidiWithSubscriptions = typeof initWebMidi & {
    _trackStoreSub?: boolean;
    _yeastNotesOffSub?: boolean;
};

const initWebMidiWithSubscriptions: InitWebMidiWithSubscriptions = initWebMidi;

vi.mock('#/utils/tauriBridge', () => ({
    isTauri: vi.fn(),
    tauriInvoke: vi.fn(),
    tauriListen: vi.fn().mockResolvedValue(() => {}),
}));

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Arrangement/stores')>();
    return {
        ...actual,
        trackStore: {
            ...actual.trackStore,
            subscribe: vi.fn(),
        },
    };
});

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
    setActiveInput: (input: MIDIInput | null) => setActiveInputMock(input),
}));

vi.mock('../../setMidiAccess', () => ({
    setMidiAccess: (access: MIDIAccess) => setMidiAccessMock(access),
}));

vi.mock('../../setState', () => ({
    setState: (next: Record<string, unknown>) => setStateMock(next),
}));

vi.mock('../../setTargetTrackId', () => ({
    setTargetTrackId: (id: string | null) => setTargetTrackIdMock(id),
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

const mockEventBus = {
    emit: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(() => () => {}),
};

describe('initWebMidi', () => {
    beforeEach(() => {
        Container.clear();
        setWebMidiEventBus(mockEventBus);
        vi.clearAllMocks();
        // Reset the idempotent guard
        initWebMidiWithSubscriptions._trackStoreSub = false;
        initWebMidiWithSubscriptions._yeastNotesOffSub = false;
    });

    it('should initialize via Web MIDI if supported', async () => {
        const mockAccess = {
            inputs: new Map([['in-1', { id: 'in-1', name: 'Keyboard' }]]),
            onstatechange: null,
        };
        requestMidiAccessMock.mockResolvedValue(mockAccess);
        getMidiAccessMock.mockReturnValue(mockAccess);

        const result = await initWebMidi();

        expect(result).toBe(true);
        expect(navigator.requestMIDIAccess).toHaveBeenCalled();
        expect(setMidiAccessMock).toHaveBeenCalledWith(mockAccess);
        expect(attachInput).toHaveBeenCalled();
    });

    it('should fallback to Tauri if Web MIDI fails', async () => {
        // Force failure of browser MIDI
        requestMidiAccessMock.mockRejectedValue(new Error('no access'));
        vi.mocked(isTauri).mockReturnValue(true);
        vi.mocked(tauriInvoke).mockResolvedValue([{ index: 0, name: 'Tauri MIDI' }]);

        const result = await initWebMidi();

        expect(result).toBe(true);
        expect(setTauriModeMock).toHaveBeenCalledWith(true);
        expect(tauriInvoke).toHaveBeenCalledWith('list_midi_inputs');
        expect(selectMidiInputTauri).toHaveBeenCalled();
    });

    it('should return false if neither is supported', async () => {
        requestMidiAccessMock.mockRejectedValue(new Error('no access'));
        vi.mocked(isTauri).mockReturnValue(false);

        const result = await initWebMidi();

        expect(result).toBe(false);
        expect(setStateMock).toHaveBeenCalledWith({ isSupported: false });
    });

    it('should subscribe to trackStore once', async () => {
        await initWebMidi();
        await initWebMidi();

        expect(trackStore.subscribe).toHaveBeenCalledTimes(1);
    });
});
