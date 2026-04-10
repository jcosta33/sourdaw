import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { copySelectedNotes } from './copySelectedNotes';

describe('copySelectedNotes', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('writes selected notes to the note clipboard', () => {
        const setNoteClipboard = vi.fn();
        injectDependencies(copySelectedNotes, {
            midiStore: {
                value: {
                    notesByClipId: {
                        c1: [
                            { id: 'n1', pitch: 60, velocity: 100, startBeat: 0, duration: 0.25 },
                            { id: 'n2', pitch: 62, velocity: 100, startBeat: 1, duration: 0.25 },
                        ],
                    },
                    ccByClipId: {},
                    pitchBendByClipId: {},
                },
                set: vi.fn(),
            } as never,
            setNoteClipboard,
        });

        copySelectedNotes('c1', ['n2']);

        expect(setNoteClipboard).toHaveBeenCalledTimes(1);
        const entry = setNoteClipboard.mock.calls[0]![0] as { notes: { id: string }[] };
        expect(entry.notes).toHaveLength(1);
        expect(entry.notes[0]!.id).toBe('n2');
    });

    it('no-ops when midi state is missing', () => {
        const setNoteClipboard = vi.fn();
        injectDependencies(copySelectedNotes, {
            midiStore: {
                value: null,
                set: vi.fn(),
            } as never,
            setNoteClipboard,
        });

        copySelectedNotes('c1', ['n1']);
        expect(setNoteClipboard).not.toHaveBeenCalled();
    });
});
