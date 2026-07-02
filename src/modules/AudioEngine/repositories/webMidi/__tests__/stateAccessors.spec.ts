import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('#/utils/tauriBridge', () => ({
    isTauri: () => false,
}));

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
        activeNotes.set(60, { channel: 1, startTime: 0, startBeat: 0 });
        channelToNote.set(1, 60);
        midiLearn.active = true;
        midiLearn.callback = vi.fn();

        resetMidiState();

        expect(activeNotes.size).toBe(0);
        expect(channelToNote.size).toBe(0);
        expect(midiLearn.active).toBe(true);
        expect(midiLearn.callback).toEqual(expect.any(Function));
    });
});
