import { beforeEach, describe, expect, it, vi } from 'vitest';

type TestMidiInput = Pick<MIDIInput, 'removeEventListener'> & {
    onmidimessage: MIDIInput['onmidimessage'];
};

const getActiveInputMock = vi.hoisted(() => vi.fn<() => TestMidiInput | null>());
const getMidiAccessMock = vi.hoisted(() => vi.fn<() => MIDIAccess | null>());
const getTauriEventUnlistenMock = vi.hoisted(() => vi.fn<() => (() => void) | null>());
const getTauriModeMock = vi.hoisted(() => vi.fn<() => boolean>());
const setActiveInputMock = vi.hoisted(() => vi.fn<(input: TestMidiInput | null) => void>());
const setMidiAccessMock = vi.hoisted(() => vi.fn<(access: MIDIAccess | null) => void>());
const setStateMock = vi.hoisted(() => vi.fn<(next: Record<string, unknown>) => void>());
const setTargetTrackIdMock = vi.hoisted(() => vi.fn<(trackId: string | null) => void>());
const setTauriEventUnlistenMock = vi.hoisted(() => vi.fn<(unlisten: (() => void) | null) => void>());
const setTauriModeMock = vi.hoisted(() => vi.fn<(enabled: boolean) => void>());
const tauriInvokeMock = vi.hoisted(() => vi.fn<(command: string) => Promise<unknown>>());

vi.mock('#/utils/tauriBridge', () => ({
    isTauri: () => false,
    tauriInvoke: tauriInvokeMock,
}));

vi.mock('../../getActiveInput', () => ({
    getActiveInput: () => getActiveInputMock(),
}));

vi.mock('../../getMidiAccess', () => ({
    getMidiAccess: () => getMidiAccessMock(),
}));

vi.mock('../../getTauriEventUnlisten', () => ({
    getTauriEventUnlisten: () => getTauriEventUnlistenMock(),
}));

vi.mock('../../getTauriMode', () => ({
    getTauriMode: () => getTauriModeMock(),
}));

vi.mock('../../setActiveInput', () => ({
    setActiveInput: (input: TestMidiInput | null) => setActiveInputMock(input),
}));

vi.mock('../../setMidiAccess', () => ({
    setMidiAccess: (access: MIDIAccess | null) => setMidiAccessMock(access),
}));

vi.mock('../../setState', () => ({
    setState: (next: Record<string, unknown>) => setStateMock(next),
}));

vi.mock('../../setTargetTrackId', () => ({
    setTargetTrackId: (trackId: string | null) => setTargetTrackIdMock(trackId),
}));

vi.mock('../../setTauriEventUnlisten', () => ({
    setTauriEventUnlisten: (unlisten: (() => void) | null) => setTauriEventUnlistenMock(unlisten),
}));

vi.mock('../../setTauriMode', () => ({
    setTauriMode: (enabled: boolean) => setTauriModeMock(enabled),
}));

const { destroyWebMidi } = await import('../destroyWebMidi');
const { webMidiRuntime, activeNotes, channelToNote, midiLearn } = await import('../../state');

describe('destroyWebMidi', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        activeNotes.clear();
        channelToNote.clear();
        midiLearn.active = false;
        midiLearn.callback = null;
        webMidiRuntime.midiMessageListener = null;
        getActiveInputMock.mockReturnValue(null);
        getMidiAccessMock.mockReturnValue(null);
        getTauriEventUnlistenMock.mockReturnValue(null);
        getTauriModeMock.mockReturnValue(false);
        tauriInvokeMock.mockResolvedValue(undefined);
    });

    it('should remove the installed browser MIDI event listener', () => {
        const activeListener = vi.fn<(event: Event) => void>();
        const activeInput = {
            onmidimessage: null,
            removeEventListener: vi.fn<(type: string, listener: EventListener) => void>(),
        };
        webMidiRuntime.midiMessageListener = activeListener;
        getActiveInputMock.mockReturnValue(activeInput);

        destroyWebMidi(() => undefined);

        expect(activeInput.removeEventListener).toHaveBeenCalledWith('midimessage', activeListener);
        expect(webMidiRuntime.midiMessageListener).toBeNull();
        expect(setActiveInputMock).toHaveBeenCalledWith(null);
    });

    it('should tear down the Tauri MIDI port when running in Tauri mode', () => {
        const unlisten = vi.fn();
        getTauriModeMock.mockReturnValue(true);
        getTauriEventUnlistenMock.mockReturnValue(unlisten);

        destroyWebMidi(() => undefined);

        expect(unlisten).toHaveBeenCalledOnce();
        expect(setTauriEventUnlistenMock).toHaveBeenCalledWith(null);
        expect(tauriInvokeMock).toHaveBeenCalledWith('close_midi_input');
        expect(setTauriModeMock).toHaveBeenCalledWith(false);
    });

    it('should leave the Tauri unlisten hook untouched when none is registered', () => {
        getTauriModeMock.mockReturnValue(true);
        getTauriEventUnlistenMock.mockReturnValue(null);

        destroyWebMidi(() => undefined);

        expect(setTauriEventUnlistenMock).not.toHaveBeenCalled();
        expect(setTauriModeMock).toHaveBeenCalledWith(false);
    });

    it('should release active Toaster notes and stop their oscillators on destroy', () => {
        const noteOff = vi.fn();
        const oscStop = vi.fn();
        activeNotes.set('1:60', {
            startTime: 0,
            startBeat: 0,
            channel: 1,
            note: 60,
            trackId: 'track-1',
            instrumentTrackId: 'inst-1',
            toasterRoute: { deviceId: 'toaster-1', pad: 3 },
            osc: { stop: oscStop } as unknown as OscillatorNode,
        });
        const getTrackStrip = vi.fn().mockReturnValue({
            deviceNodes: [{ deviceId: 'toaster-1', toasterControls: { noteOff } }],
        });

        destroyWebMidi(getTrackStrip);

        expect(noteOff).toHaveBeenCalledWith(3);
        expect(oscStop).toHaveBeenCalledOnce();
        expect(activeNotes.size).toBe(0);
        expect(channelToNote.size).toBe(0);
    });

    it('should clear the active notes map even for notes without a Toaster route or oscillator', () => {
        activeNotes.set('0:64', {
            startTime: 0,
            startBeat: 0,
            channel: 0,
            note: 64,
            trackId: 'track-2',
            instrumentTrackId: 'inst-2',
        });

        destroyWebMidi(() => undefined);

        expect(activeNotes.size).toBe(0);
    });

    it('should detach the Web MIDI access state-change listener on destroy', () => {
        const access = { onstatechange: (() => undefined) as MIDIAccess['onstatechange'] };
        getMidiAccessMock.mockReturnValue(access as unknown as MIDIAccess);

        destroyWebMidi(() => undefined);

        expect(access.onstatechange).toBeNull();
        expect(setMidiAccessMock).toHaveBeenCalledWith(null);
    });

    it('should reset midi learn, target track, and the inputs state on destroy', () => {
        midiLearn.active = true;
        midiLearn.callback = vi.fn();
        getTauriModeMock.mockReturnValue(false);

        destroyWebMidi(() => undefined);

        expect(midiLearn.active).toBe(false);
        expect(midiLearn.callback).toBeNull();
        expect(setTargetTrackIdMock).toHaveBeenCalledWith(null);
        expect(setStateMock).toHaveBeenCalledWith({ inputs: [], selectedInputId: null });
    });
});
