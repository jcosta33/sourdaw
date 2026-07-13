import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type MidiStoreState } from '../../../stores/midiStore';

vi.mock('../../../stores/midiStore', () => {
    const midiStore = {
        value: null as MidiStoreState | null,
        set: vi.fn<(state: MidiStoreState) => void>(),
    };
    midiStore.set.mockImplementation((state) => {
        midiStore.value = state;
    });

    return { midiStore };
});

const { removeMidiClipData } = await import('../removeMidiClipData');
const { midiStore } = await import('../../../stores/midiStore');

function createMidiState(): MidiStoreState {
    return {
        notesByClipId: {
            'clip-note-only': [{ id: 'note-remove', pitch: 60, startBeat: 0, duration: 1, velocity: 100 }],
            'clip-keep': [{ id: 'note-keep', pitch: 64, startBeat: 1, duration: 0.5, velocity: 90 }],
        },
        ccByClipId: {
            'clip-cc-only': [{ id: 'cc-remove', controller: 1, value: 80, beat: 0, channel: 1 }],
            'clip-keep': [{ id: 'cc-keep', controller: 11, value: 96, beat: 1, channel: 1 }],
        },
        pitchBendByClipId: {
            'clip-pitch-only': [{ id: 'pitch-remove', value: 512, beat: 0, channel: 1 }],
            'clip-keep': [{ id: 'pitch-keep', value: -256, beat: 1, channel: 1 }],
        },
    };
}

describe('removeMidiClipData', () => {
    beforeEach(() => {
        vi.mocked(midiStore.set).mockClear();
        midiStore.value = createMidiState();
    });

    it('removes matching data from all MIDI maps in one write and preserves unrelated entries', () => {
        removeMidiClipData(['clip-note-only', 'clip-cc-only', 'clip-pitch-only']);

        expect(midiStore.set).toHaveBeenCalledTimes(1);
        expect(midiStore.value).toEqual({
            notesByClipId: {
                'clip-keep': [{ id: 'note-keep', pitch: 64, startBeat: 1, duration: 0.5, velocity: 90 }],
            },
            ccByClipId: {
                'clip-keep': [{ id: 'cc-keep', controller: 11, value: 96, beat: 1, channel: 1 }],
            },
            pitchBendByClipId: {
                'clip-keep': [{ id: 'pitch-keep', value: -256, beat: 1, channel: 1 }],
            },
        });
    });

    it('clones all three maps when only one map contains a matching clip id', () => {
        const state = midiStore.value;
        if (!state) {
            throw new Error('Expected initialized MIDI state');
        }

        removeMidiClipData(['clip-note-only']);

        const nextState = midiStore.value;

        expect(midiStore.set).toHaveBeenCalledTimes(1);
        expect(nextState.notesByClipId).not.toBe(state.notesByClipId);
        expect(nextState.ccByClipId).not.toBe(state.ccByClipId);
        expect(nextState.pitchBendByClipId).not.toBe(state.pitchBendByClipId);
        expect(nextState.ccByClipId).toEqual(state.ccByClipId);
        expect(nextState.pitchBendByClipId).toEqual(state.pitchBendByClipId);
    });

    it('does not write when the MIDI store is unavailable', () => {
        midiStore.value = null;

        removeMidiClipData(['clip-note-only']);

        expect(midiStore.set).not.toHaveBeenCalled();
    });

    it('does not write for an empty clip-id batch', () => {
        const state = midiStore.value;

        removeMidiClipData([]);

        expect(midiStore.set).not.toHaveBeenCalled();
        expect(midiStore.value).toBe(state);
    });

    it('does not write when no clip data matches the requested ids', () => {
        const state = midiStore.value;

        removeMidiClipData(['clip-missing']);

        expect(midiStore.set).not.toHaveBeenCalled();
        expect(midiStore.value).toBe(state);
    });

    it('deduplicates clip ids while removing the matching data once', () => {
        removeMidiClipData(['clip-note-only', 'clip-note-only']);

        expect(midiStore.set).toHaveBeenCalledTimes(1);
        expect(midiStore.value?.notesByClipId).not.toHaveProperty('clip-note-only');
        expect(midiStore.value?.notesByClipId).toHaveProperty('clip-keep');
    });
});
