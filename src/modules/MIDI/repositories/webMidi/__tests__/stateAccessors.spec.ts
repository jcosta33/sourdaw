import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('#/utils/desktopBridge', () => ({
    isDesktopRuntime: () => false,
}));

import { createWebMidiNoteKey } from '../../../models/WebMidiTypes';
import { getState } from '../getState';
import { resetMidiState } from '../lifecycle/resetMidiState';
import { setState } from '../setState';
import { activeNotes, channelToNote, midiLearn } from '../state';
import { subscribe } from '../subscribe';

describe('webMidi state accessors', () => {
    beforeEach(() => {
        window.localStorage.clear();
        activeNotes.clear();
        channelToNote.clear();
        midiLearn.active = false;
        midiLearn.callback = null;
        setState({
            isSupported: false,
            inputs: [],
            selectedInputId: null,
        });
    });

    it('should persist selected input changes and notify subscribers', () => {
        const subscriber = vi.fn();
        const unsubscribe = subscribe(subscriber);

        setState({ selectedInputId: 'input-1' });

        expect(getState().selectedInputId).toBe('input-1');
        expect(window.localStorage.getItem('sourdaw:midi:selectedInputId')).toBe('input-1');
        expect(subscriber).toHaveBeenCalledTimes(1);

        unsubscribe();
        setState({ selectedInputId: null });

        expect(window.localStorage.getItem('sourdaw:midi:selectedInputId')).toBeNull();
        expect(subscriber).toHaveBeenCalledTimes(1);
    });

    it('should clear the shared held-note maps on transport reset', () => {
        const key = createWebMidiNoteKey(1, 60);
        activeNotes.set(key, {
            channel: 1,
            note: 60,
            trackId: 'track-1',
            instrumentTrackId: 'track-1',
            startTime: 0,
            startBeat: 0,
        });
        channelToNote.set(1, key);

        resetMidiState({ getCurrentTime: () => 0, getTrackStrip: () => undefined });

        expect(activeNotes.size).toBe(0);
        expect(channelToNote.size).toBe(0);
    });

    // `resetMidiState` is the transport stop/seek path: it releases sounding
    // voices and decoded channel state, but an armed MIDI learn belongs to the
    // user's mapping gesture and must survive it. Disarming learn is teardown
    // (`destroyWebMidi`), not reset (issue #1837 F15).
    it('should leave an armed MIDI learn armed across transport reset', () => {
        const learnCallback = vi.fn();
        midiLearn.active = true;
        midiLearn.callback = learnCallback;

        resetMidiState({ getCurrentTime: () => 0, getTrackStrip: () => undefined });

        expect(midiLearn.active).toBe(true);
        expect(midiLearn.callback).toEqual(expect.any(Function));
        expect(midiLearn.callback).toBe(learnCallback);
    });
});
