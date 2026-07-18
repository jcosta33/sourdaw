import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('#/utils/tauriBridge', () => ({
    isTauri: () => false,
}));

import { createWebMidiNoteKey } from '../../../models/WebMidiTypes';
import { getSnapshot } from '../getSnapshot';
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
        expect(getSnapshot().selectedInputId).toBe('input-1');
        expect(window.localStorage.getItem('sourdaw:midi:selectedInputId')).toBe('input-1');
        expect(subscriber).toHaveBeenCalledTimes(1);

        unsubscribe();
        setState({ selectedInputId: null });

        expect(window.localStorage.getItem('sourdaw:midi:selectedInputId')).toBeNull();
        expect(subscriber).toHaveBeenCalledTimes(1);
    });

    it('should share singleton runtime maps with lifecycle cleanup', () => {
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
        midiLearn.active = true;
        midiLearn.callback = vi.fn();

        resetMidiState({ getCurrentTime: () => 0, getTrackStrip: () => undefined });

        expect(activeNotes.size).toBe(0);
        expect(channelToNote.size).toBe(0);
        expect(midiLearn.active).toBe(true);
        expect(midiLearn.callback).toEqual(expect.any(Function));
    });
});
