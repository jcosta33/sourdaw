import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Pins teardown against the persisted preference with the real state chain:
 * the use case, the repository teardown, the real `setState` and the real
 * `persistInputId`/`readPersistedInputId` over real `localStorage`. Mocking
 * the state layer here is exactly what let the preference erasure slip past
 * the other destroyWebMidi specs — the write had to be observable at the
 * storage boundary to be caught at all.
 *
 * The desktop bridge is stubbed at the same seam the adapter itself reads —
 * `window.sourdaw` — rather than by naming the adapter module here: the IPC
 * boundary rule forbids every use-case-layer reference to it, mock or import.
 */
vi.mock('#/modules/AudioEngine/useCases', () => ({
    audioEngine: {
        context: { currentTime: 0 },
        getTrackStrip: () => undefined,
        sendNativeLiveMidiNote: vi.fn(async () => true),
    },
}));

type WindowWithDesktopBridge = Window & {
    sourdaw?: { invoke: (command: string, args: unknown[]) => Promise<unknown> };
};

const invokeDesktopCommand = vi.fn<(command: string, args: unknown[]) => Promise<unknown>>(async () => undefined);

import { getState } from '../../../repositories/webMidi/getState';
import { readPersistedInputId } from '../../../repositories/webMidi/readPersistedInputId';
import { setNativeMode } from '../../../repositories/webMidi/setNativeMode';
import { activeNotes, channelToNote, midiLearn, webMidiRuntime } from '../../../repositories/webMidi/state';
import { destroyWebMidi } from '../destroyWebMidi';

const SEEDED_ID = '2';

describe('destroyWebMidi leaves the saved device preference alone', () => {
    beforeEach(() => {
        invokeDesktopCommand.mockClear();
        (window as WindowWithDesktopBridge).sourdaw = { invoke: invokeDesktopCommand };
        window.localStorage.setItem('sourdaw:midi:selectedInputId', SEEDED_ID);
        activeNotes.clear();
        channelToNote.clear();
        midiLearn.active = false;
        midiLearn.callback = null;
        webMidiRuntime.midiAccess = null;
        webMidiRuntime.activeInput = null;
        webMidiRuntime.midiMessageListener = null;
        webMidiRuntime.nativeEventUnlisten = null;
        setNativeMode(true);
        expect(readPersistedInputId()).toBe(SEEDED_ID);
    });

    afterEach(() => {
        delete (window as WindowWithDesktopBridge).sourdaw;
        window.localStorage.removeItem('sourdaw:midi:selectedInputId');
    });

    it('clears the session selection but keeps the persisted device on teardown', () => {
        destroyWebMidi();

        // The native handle release still ran through the real adapter seam.
        expect(invokeDesktopCommand).toHaveBeenCalledWith('close_midi_input', []);
        expect(readPersistedInputId()).toBe(SEEDED_ID);
        expect(getState().selectedInputId).toBeNull();
    });
});
