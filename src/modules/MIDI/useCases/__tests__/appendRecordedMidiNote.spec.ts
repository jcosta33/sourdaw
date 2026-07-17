import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type MidiStoreState } from '../../stores/midiStore';

const mocks = vi.hoisted(() => {
    const state: { value: MidiStoreState | null } = { value: null };
    return { state };
});

vi.mock('../../stores/midiStore', () => ({
    midiStore: {
        get value() {
            return mocks.state.value;
        },
        set: vi.fn((next: MidiStoreState | null) => {
            mocks.state.value = next;
        }),
    },
}));

const { appendRecordedMidiNote } = await import('../appendRecordedMidiNote');
const { midiStore } = await import('../../stores/midiStore');

describe('appendRecordedMidiNote', () => {
    beforeEach(() => {
        vi.mocked(midiStore.set).mockClear();
        mocks.state.value = {
            notesByClipId: {
                'clip-1': [
                    {
                        id: 'note-existing',
                        pitch: 55,
                        startBeat: 1,
                        duration: 0.5,
                        velocity: 80,
                    },
                ],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        };
    });

    it('should append a recorded note without replacing existing clip notes', () => {
        const note = {
            id: 'note-recorded',
            pitch: 60,
            startBeat: 2,
            duration: 1,
            velocity: 100,
            pressure: 70,
            slide: 42,
            pitchBend: 128,
        };

        appendRecordedMidiNote({ clipId: 'clip-1', note });

        expect(midiStore.set).toHaveBeenCalledWith({
            notesByClipId: {
                'clip-1': [
                    {
                        id: 'note-existing',
                        pitch: 55,
                        startBeat: 1,
                        duration: 0.5,
                        velocity: 80,
                    },
                    note,
                ],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
    });

    it('should be a no-op when MIDI state is unavailable', () => {
        mocks.state.value = null;

        appendRecordedMidiNote({
            clipId: 'clip-1',
            note: {
                id: 'note-recorded',
                pitch: 60,
                startBeat: 2,
                duration: 1,
                velocity: 100,
            },
        });

        expect(midiStore.set).not.toHaveBeenCalled();
    });
});
