import { beforeEach, describe, expect, it, vi } from 'vitest';

type TestMidiInput = Pick<MIDIInput, 'removeEventListener'> & {
    onmidimessage: MIDIInput['onmidimessage'];
};

const getActiveInputMock = vi.hoisted(() => vi.fn<TestMidiInput | null, []>());
const getMidiAccessMock = vi.hoisted(() => vi.fn<MIDIAccess | null, []>());
const getTauriEventUnlistenMock = vi.hoisted(() => vi.fn<(() => void) | null, []>());
const getTauriModeMock = vi.hoisted(() => vi.fn<boolean, []>());
const setActiveInputMock = vi.hoisted(() => vi.fn<void, [TestMidiInput | null]>());
const setMidiAccessMock = vi.hoisted(() => vi.fn<void, [MIDIAccess | null]>());
const setStateMock = vi.hoisted(() => vi.fn<void, [Record<string, unknown>]>());
const setTargetTrackIdMock = vi.hoisted(() => vi.fn<void, [string | null]>());
const setTauriEventUnlistenMock = vi.hoisted(() => vi.fn<void, [(() => void) | null]>());
const setTauriModeMock = vi.hoisted(() => vi.fn<void, [boolean]>());
const tauriInvokeMock = vi.hoisted(() => vi.fn<Promise<unknown>, [string]>());

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
        const activeListener = vi.fn<void, [Event]>();
        const activeInput = {
            onmidimessage: null,
            removeEventListener: vi.fn<void, [string, EventListener]>(),
        };
        webMidiRuntime.midiMessageListener = activeListener;
        getActiveInputMock.mockReturnValue(activeInput);

        destroyWebMidi();

        expect(activeInput.removeEventListener).toHaveBeenCalledWith('midimessage', activeListener);
        expect(webMidiRuntime.midiMessageListener).toBeNull();
        expect(setActiveInputMock).toHaveBeenCalledWith(null);
    });
});
