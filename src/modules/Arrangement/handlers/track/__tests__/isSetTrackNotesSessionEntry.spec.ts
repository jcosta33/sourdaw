import { describe, expect, it, vi } from 'vitest';

import { type AppAction } from '#/utils/handlerContract';
import { MAX_TRACK_NOTES_LENGTH } from '#/utils/trackNotesLimits';

import { isSetTrackNotesSessionEntry } from '../isSetTrackNotesSessionEntry';
import { handleSetTrackNotes } from '../setTrackNotes';

const mocks = vi.hoisted(() => ({
    getTrackStoreState: vi.fn(() => ({ tracks: [{ id: 't1', notes: 'old' }] })),
}));

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

function notes(trackId: string, text: string, expectedNotes?: string): AppAction {
    return { type: 'setTrackNotes', payload: { trackId, notes: text, expectedNotes } };
}

const forward = notes('t1', 'new');
const inverse = notes('t1', 'old', 'new');
const redo = notes('t1', 'new', 'old');
const oversize = 'x'.repeat(MAX_TRACK_NOTES_LENGTH + 1);

describe('isSetTrackNotesSessionEntry', () => {
    it('accepts the entry the handler describes', () => {
        const action: Extract<AppAction, { type: 'setTrackNotes' }> = {
            type: 'setTrackNotes',
            payload: { trackId: 't1', notes: 'new' },
        };
        const description = handleSetTrackNotes.describe(action, { actions: [action], actionIndex: 0 });

        expect(description.inverseAction).toEqual(inverse);
        expect(description.redoAction).toEqual(redo);
        expect(
            isSetTrackNotesSessionEntry({
                action: forward,
                inverseAction: description.inverseAction ?? null,
                redoAction: description.redoAction,
            })
        ).toBe(true);
    });

    it('accepts an entry with no inverse and no redo', () => {
        expect(isSetTrackNotesSessionEntry({ action: forward, inverseAction: null })).toBe(true);
    });

    it.each([
        ['a redo on a foreign track', inverse, notes('t2', 'new', 'old')],
        ['an inverse on a foreign track', notes('t2', 'old', 'new'), redo],
        ['an unguarded redo', inverse, notes('t1', 'new')],
        ['an unguarded inverse', notes('t1', 'old'), redo],
        ['an inverse guarded by notes the action did not leave', notes('t1', 'old', 'other'), redo],
        ['a redo that writes other notes', inverse, notes('t1', 'other', 'old')],
        ['a redo that does not start where the inverse ends', inverse, notes('t1', 'new', 'other')],
        ['oversize restore notes', notes('t1', oversize, 'new'), notes('t1', 'new', oversize)],
        ['an inverse of another action type', { type: 'hideTrack', payload: { trackId: 't1', hidden: false } }, redo],
        ['no redo', inverse, undefined],
    ] as const)('refuses %s', (_name, badInverse, badRedo) => {
        expect(isSetTrackNotesSessionEntry({ action: forward, inverseAction: badInverse, redoAction: badRedo })).toBe(
            false
        );
    });

    it('refuses oversize forward notes', () => {
        expect(
            isSetTrackNotesSessionEntry({
                action: notes('t1', oversize),
                inverseAction: notes('t1', 'old', oversize),
                redoAction: notes('t1', oversize, 'old'),
            })
        ).toBe(false);
    });

    it('refuses an entry whose forward action is not a notes edit', () => {
        expect(
            isSetTrackNotesSessionEntry({
                action: { type: 'hideTrack', payload: { trackId: 't1', hidden: true } },
                inverseAction: inverse,
                redoAction: redo,
            })
        ).toBe(false);
    });
});
