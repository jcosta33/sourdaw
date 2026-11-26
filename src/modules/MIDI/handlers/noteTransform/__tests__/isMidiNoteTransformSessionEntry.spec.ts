import { describe, expect, it } from 'vitest';

import { type AppAction, type HandlerSessionActionEntry } from '#/utils/handlerContract';

import { type MidiNote } from '../../../models/MidiNote';
import { handleScaleVelocities } from '../handleScaleVelocities';
import { isMidiNoteTransformSessionEntry } from '../isMidiNoteTransformSessionEntry';

const CLIP_ID = 'clip-1';
const GUARD = { trackId: 'track-1', expectedTrackFrozen: false, expectedClipLocked: false };

function note(id: string, velocity: number): MidiNote {
    return { id, pitch: 60, startBeat: 0, duration: 1, velocity };
}

const SOURCE = [note('a', 20), note('b', 100)];
const halve = (notes: readonly MidiNote[]): MidiNote[] => notes.map((n) => ({ ...n, velocity: n.velocity / 2 }));
const RESULT = halve(SOURCE);

type Restore = Extract<AppAction, { type: 'restoreMidiClipNotes' }>;

function restore(overrides: Partial<Restore['payload']>): Restore {
    return {
        type: 'restoreMidiClipNotes',
        payload: {
            clipId: CLIP_ID,
            notes: SOURCE,
            expectedNotes: RESULT,
            noteTransformReplayGuard: GUARD,
            ...overrides,
        },
    };
}

function entry(inverseAction: AppAction | null, redoAction: AppAction | undefined): HandlerSessionActionEntry {
    return { action: { type: 'invertNotes', payload: { clipId: CLIP_ID } }, inverseAction, redoAction };
}

const redoRestore = restore({ notes: RESULT, expectedNotes: SOURCE });

function check(candidate: HandlerSessionActionEntry): boolean {
    return isMidiNoteTransformSessionEntry({ entry: candidate, clipId: CLIP_ID, transform: halve });
}

describe('isMidiNoteTransformSessionEntry', () => {
    it('admits a guarded swapped pair whose stored result is what the transform yields for the stored source', () => {
        expect(check(entry(restore({}), redoRestore))).toBe(true);
    });

    it('refuses an entry whose inverse or redo is not a restoreMidiClipNotes', () => {
        expect(check(entry({ type: 'togglePlayback' }, redoRestore))).toBe(false);
        expect(check(entry(restore({}), { type: 'togglePlayback' }))).toBe(false);
        expect(check(entry(null, redoRestore))).toBe(false);
        expect(check(entry(restore({}), undefined))).toBe(false);
    });

    it('refuses a restore that names another clip or carries a malformed note snapshot', () => {
        expect(check(entry(restore({ clipId: 'other-clip' }), redoRestore))).toBe(false);
        expect(check(entry(restore({}), restore({ clipId: 'other-clip', notes: RESULT, expectedNotes: SOURCE })))).toBe(
            false
        );
        const malformed = [{ id: 'a', pitch: 'C4' }] as unknown as MidiNote[];
        expect(check(entry(restore({ notes: malformed }), redoRestore))).toBe(false);
    });

    it('refuses a pair that is unguarded, guarded for a frozen track or locked clip, or guards two tracks', () => {
        expect(check(entry(restore({ noteTransformReplayGuard: undefined }), redoRestore))).toBe(false);
        expect(
            check(entry(restore({ noteTransformReplayGuard: { ...GUARD, expectedTrackFrozen: true } }), redoRestore))
        ).toBe(false);
        expect(
            check(entry(restore({ noteTransformReplayGuard: { ...GUARD, expectedClipLocked: true } }), redoRestore))
        ).toBe(false);
        const otherTrack = restore({
            notes: RESULT,
            expectedNotes: SOURCE,
            noteTransformReplayGuard: { ...GUARD, trackId: 'track-2' },
        });
        expect(check(entry(restore({}), otherTrack))).toBe(false);
    });

    it('refuses a redo that is not the inverse swapped, a no-op, and a result the transform does not yield', () => {
        expect(
            check(entry(restore({}), restore({ notes: RESULT, expectedNotes: [note('a', 21), note('b', 100)] })))
        ).toBe(false);
        const noop = restore({ notes: SOURCE, expectedNotes: SOURCE });
        expect(check(entry(noop, noop))).toBe(false);
        const tampered = [note('a', 11), note('b', 50)];
        expect(
            check(entry(restore({ expectedNotes: tampered }), restore({ notes: tampered, expectedNotes: SOURCE })))
        ).toBe(false);
    });
});

describe('handleScaleVelocities session entries', () => {
    it('refuses an entry whose stored action is not scaleVelocities', () => {
        expect(handleScaleVelocities.validateSessionEntry?.(entry(restore({}), redoRestore))).toBe(false);
    });
});
