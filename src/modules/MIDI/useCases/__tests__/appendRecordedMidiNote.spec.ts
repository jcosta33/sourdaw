import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type MidiStoreState } from '../../stores/midiStore';

vi.mock('../../stores/midiStore', () => {
    const midiStore: {
        value: MidiStoreState | null;
        set: ReturnType<typeof vi.fn>;
    } = {
        value: {
            notesByClipId: {},
            ccByClipId: {},
            pitchBendByClipId: {},
        },
        set: vi.fn(),
    };
    midiStore.set.mockImplementation((next: MidiStoreState) => {
        midiStore.value = next;
    });
    return { midiStore };
});

const { appendRecordedMidiNote } = await import('../appendRecordedMidiNote');
const { midiStore } = await import('../../stores/midiStore');

describe('appendRecordedMidiNote', () => {
    beforeEach(() => {
        vi.mocked(midiStore.set).mockClear();
        midiStore.value = {
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
        midiStore.value = null;

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
