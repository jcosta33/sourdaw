import { describe, it, expect, vi, beforeEach } from 'vitest';

import { isNoteEditKey, refuseNoteEditOnFrozenTrack, willWriteNotes } from '../refuseNoteEditOnFrozenTrack';

const mocks = vi.hoisted(() => ({
    notifyUser: vi.fn(),
    trackState: { tracks: [] as Array<{ id: string; frozen: boolean; clips: Array<{ id: string }> }> },
}));

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/stores')>()),
    trackStore: {
        get value() {
            return mocks.trackState;
        },
    },
}));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: mocks.notifyUser }));

describe('refuseNoteEditOnFrozenTrack', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.trackState.tracks = [
            { id: 'frozen-track', frozen: true, clips: [{ id: 'frozen-clip' }] },
            { id: 'live-track', frozen: false, clips: [{ id: 'live-clip' }] },
        ];
    });

    it('refuses with one warning when any named clip is on a frozen track', () => {
        expect(refuseNoteEditOnFrozenTrack(['live-clip', 'frozen-clip'])).toBe(true);
        expect(mocks.notifyUser).toHaveBeenCalledExactlyOnceWith(
            'This track is frozen. Unfreeze it to edit its notes.',
            'warning'
        );
    });

    it.each([[['live-clip']], [[null]], [['unknown-clip']], [[]]])('admits %j without a warning', (clipIds) => {
        expect(refuseNoteEditOnFrozenTrack(clipIds)).toBe(false);
        expect(mocks.notifyUser).not.toHaveBeenCalled();
    });
});

describe('isNoteEditKey', () => {
    const press = (key: string, modifiers: Partial<Record<'metaKey' | 'ctrlKey' | 'shiftKey', boolean>> = {}) => ({
        key,
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        ...modifiers,
    });
    const selected = { selectedCount: 2, stepInput: false };

    it.each([
        ['Delete', press('Delete'), selected, true],
        ['Backspace', press('Backspace'), selected, true],
        ['Delete with nothing selected', press('Delete'), { selectedCount: 0, stepInput: false }, false],
        ['Ctrl+D with nothing selected', press('d', { ctrlKey: true }), { selectedCount: 0, stepInput: false }, true],
        ['Cmd+Shift+D', press('d', { metaKey: true, shiftKey: true }), selected, false],
        ['arrow nudge', press('ArrowUp'), selected, true],
        ['arrow in step input moves the cursor', press('ArrowUp'), { selectedCount: 2, stepInput: true }, false],
        ['legato', press('l'), selected, true],
        ['join', press('j'), selected, true],
        ['split', press('S', { shiftKey: true }), selected, true],
        ['select all', press('a', { metaKey: true }), selected, false],
        ['velocity preset in step input', press('3'), { selectedCount: 2, stepInput: true }, true],
        ['digit outside step input', press('3'), selected, false],
        ['Cmd+L', press('l', { metaKey: true }), selected, false],
    ])('%s', (_name, event, context, expected) => {
        expect(isNoteEditKey(event, context)).toBe(expected);
    });
});

describe('willWriteNotes', () => {
    const grown = { w: 40, h: 40 };

    it.each([
        ['a resized note with a preview', 'resize-right', {}, null, null, true],
        ['a move with a preview', 'move', {}, null, null, true],
        ['a press on a note that never moved', 'move', null, null, null, false],
        ['a click-stamp left pending', 'rubber-band', null, { pitch: 60 }, { w: 0, h: 0 }, true],
        ['a rubber-band drag that grew', 'rubber-band', null, { pitch: 60 }, grown, false],
        ['a rubber-band with no stamp', 'rubber-band', null, null, { w: 0, h: 0 }, false],
        ['paint mode', 'paint', null, null, null, false],
    ])('%s', (_name, mode, preview, pendingStamp, rubberBand, expected) => {
        const refs = {
            dragPreviewRef: { current: preview },
            pendingStampRef: { current: pendingStamp },
            rubberBandRef: { current: rubberBand },
        };
        expect(willWriteNotes(mode, refs)).toBe(expected);
    });
});
