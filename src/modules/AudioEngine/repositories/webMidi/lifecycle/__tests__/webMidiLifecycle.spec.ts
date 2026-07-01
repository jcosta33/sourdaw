import { vi, describe, it, expect, beforeEach } from 'vitest';

const getMidiAccessMock = vi.hoisted(() => vi.fn<unknown, []>());
const requestMidiAccessMock = vi.hoisted(() => vi.fn<Promise<unknown>, []>());

// Must stub before importing the subject
vi.stubGlobal('navigator', {
    requestMIDIAccess: requestMidiAccessMock,
});

import { Container } from '#/infra/di/Container';
import { trackStore } from '#/modules/Arrangement/stores';
import { isTauri, tauriInvoke } from '#/utils/tauriBridge';

import * as state from '../../state';
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

vi.mock('../../state', () => ({
    getMidiAccess: () => getMidiAccessMock(),
    getActiveInput: vi.fn(),
    setState: vi.fn(),
    getState: vi.fn(() => ({ isSupported: true, inputs: [], selectedInputId: null })),
    subscribe: vi.fn(() => vi.fn()),
    getSnapshot: vi.fn(() => ({ isSupported: true, inputs: [], selectedInputId: null })),
    setMidiAccess: vi.fn(),
    setActiveInput: vi.fn(),
    setTauriMode: vi.fn(),
    setTargetTrackId: vi.fn(),
    getTauriEventUnlisten: vi.fn(),
    setTauriEventUnlisten: vi.fn(),
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
        expect(state.setMidiAccess).toHaveBeenCalledWith(mockAccess);
        expect(attachInput).toHaveBeenCalled();
    });

    it('should fallback to Tauri if Web MIDI fails', async () => {
        // Force failure of browser MIDI
        requestMidiAccessMock.mockRejectedValue(new Error('no access'));
        vi.mocked(isTauri).mockReturnValue(true);
        vi.mocked(tauriInvoke).mockResolvedValue([{ index: 0, name: 'Tauri MIDI' }]);

        const result = await initWebMidi();

        expect(result).toBe(true);
        expect(state.setTauriMode).toHaveBeenCalledWith(true);
        expect(tauriInvoke).toHaveBeenCalledWith('list_midi_inputs');
        expect(selectMidiInputTauri).toHaveBeenCalled();
    });

    it('should return false if neither is supported', async () => {
        requestMidiAccessMock.mockRejectedValue(new Error('no access'));
        vi.mocked(isTauri).mockReturnValue(false);

        const result = await initWebMidi();

        expect(result).toBe(false);
        expect(state.setState).toHaveBeenCalledWith({ isSupported: false });
    });

    it('should subscribe to trackStore once', async () => {
        await initWebMidi();
        await initWebMidi();

        expect(trackStore.subscribe).toHaveBeenCalledTimes(1);
    });
});
