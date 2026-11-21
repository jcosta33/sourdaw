import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { defaultStepRecordState, stepRecordStore } from '#/modules/MIDI/stores';

import { keyClips, ownerClipIds, refuseNoteEditOnFrozenTrack, releaseClips } from '../refuseNoteEditOnFrozenTrack';

const mocks = vi.hoisted(() => ({
    notifyUser: vi.fn(),
    playheadBeat: 1 as number | undefined,
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
vi.mock('../clipPlayheadBeat', () => ({ readClipPlayheadBeat: () => mocks.playheadBeat }));

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

const note = (id: string) => ({ id });
const owners = {
    clipId: 'primary',
    targetClipId: 'primary',
    notes: [note('p1'), note('p2')],
    openedClipNotes: { primary: [note('p1')], other: [note('o1')], empty: [] },
};

describe('ownerClipIds', () => {
    it.each([
        [['p1'], ['primary']],
        [['o1'], ['other']],
        [
            ['p1', 'o1'],
            ['primary', 'other'],
        ],
        [['missing'], []],
        [[], []],
    ])('%j is owned by %j', (ids, expected) => {
        expect(ownerClipIds(new Set(ids), owners)).toEqual(expected);
    });
});

describe('keyClips', () => {
    const press = (key: string, modifiers: Partial<Record<'metaKey' | 'ctrlKey' | 'shiftKey', boolean>> = {}) => ({
        key,
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        ...modifiers,
    });
    const context = (selected: string[], stepInput = false, isTakeView: (id: string) => unknown = () => undefined) => ({
        selectedNoteIds: new Set(selected),
        stepInput,
        owners,
        isTakeView,
    });

    beforeEach(() => {
        mocks.playheadBeat = 1;
    });

    afterEach(() => {
        stepRecordStore.set(defaultStepRecordState);
    });

    it.each([
        ['Delete', press('Delete'), context(['p1', 'o1']), ['primary', 'other']],
        ['Backspace', press('Backspace'), context(['o1']), ['other']],
        ['Delete with nothing selected', press('Delete'), context([]), []],
        ['Delete with a stale selection', press('Delete'), context(['gone']), []],
        ['Ctrl+D on a selection', press('d', { ctrlKey: true }), context(['o1']), ['other']],
        [
            'Ctrl+D with nothing selected duplicates the primary clip',
            press('d', { ctrlKey: true }),
            context([]),
            ['primary'],
        ],
        ['Cmd+Shift+D', press('d', { metaKey: true, shiftKey: true }), context(['p1']), []],
        ['arrow nudge', press('ArrowUp'), context(['p1', 'o1']), ['primary', 'other']],
        ['arrow in step input moves the cursor', press('ArrowUp'), context(['p1'], true), []],
        ['legato in one clip', press('l'), context(['o1']), ['other']],
        ['join in one clip', press('j'), context(['p1', 'p2']), ['primary']],
        ['join with one note selected does nothing', press('j'), context(['p1']), []],
        ['join in step input does nothing', press('j'), context(['p1', 'p2'], true), []],
        ['split in one clip', press('S', { shiftKey: true }), context(['p1']), ['primary']],
        ['split in step input still splits', press('S', { shiftKey: true }), context(['o1'], true), ['other']],
        ['split across two clips does nothing', press('S', { shiftKey: true }), context(['p1', 'o1']), []],
        ['legato across two clips does nothing', press('l'), context(['p1', 'o1']), []],
        ['legato on a take view does nothing', press('l'), context(['p1'], false, () => ({})), []],
        ['select all', press('a', { metaKey: true }), context(['p1']), []],
        ['velocity preset in step input', press('3'), context(['o1'], true), ['other']],
        ['digit outside step input', press('3'), context(['o1']), []],
        ['Cmd+L', press('l', { metaKey: true }), context(['p1']), []],
    ])('%s', (_name, event, keyContext, expected) => {
        expect(keyClips(event, keyContext)).toEqual(expected);
    });

    it('resolves split to nothing when the playhead is outside the clip, so no beat resolves', () => {
        mocks.playheadBeat = undefined;

        expect(keyClips(press('S', { shiftKey: true }), context(['p1']))).toEqual([]);
    });

    it('resolves Ctrl+D with nothing selected in an empty primary clip to nothing', () => {
        const emptyPrimary = { ...context([]), owners: { ...owners, notes: [] } };

        expect(keyClips(press('d', { ctrlKey: true }), emptyPrimary)).toEqual([]);
    });

    it('resolves Ctrl+Space in step input to the step-recording clip', () => {
        stepRecordStore.set({ ...defaultStepRecordState, active: true, clipId: 'other' });

        expect(keyClips(press(' ', { ctrlKey: true }), context([], true))).toEqual(['other']);
    });

    it('resolves Ctrl+Space to nothing when step recording is off or outside step input', () => {
        expect(keyClips(press(' ', { ctrlKey: true }), context([], true))).toEqual([]);

        stepRecordStore.set({ ...defaultStepRecordState, active: true, clipId: 'other' });

        expect(keyClips(press(' ', { ctrlKey: true }), context([], false))).toEqual([]);
    });
});

describe('releaseClips', () => {
    const drag = (mode: string, noteId: string | null = 'o1') => ({ mode, noteId, origBeat: 2, origDuration: 2 });
    type PreviewOverrides = {
        noteIds?: Set<string>;
        beatDelta?: number;
        pitchDelta?: number;
        beatOverride?: Map<string, { beat: number; duration: number }>;
        durationOverride?: Map<string, number>;
    };
    const preview = (overrides: PreviewOverrides = {}) => ({
        noteIds: new Set(['o1']),
        beatDelta: 0,
        pitchDelta: 0,
        ...overrides,
    });
    const refs = (
        dragPreview: ReturnType<typeof preview> | null,
        pendingStamp: unknown,
        rubberBand: { w: number; h: number } | null
    ) => ({
        dragPreviewRef: { current: dragPreview },
        pendingStampRef: { current: pendingStamp },
        rubberBandRef: { current: rubberBand },
    });
    const targetOther = { ...owners, targetClipId: 'other' };
    const twoClipMove = preview({ noteIds: new Set(['p1', 'o1']), beatDelta: 1 });

    it.each([
        [
            'a right resize that changes the duration',
            drag('resize-right'),
            refs(preview({ durationOverride: new Map([['o1', 3]]) }), null, null),
            ['other'],
        ],
        [
            'a right resize back to its own duration',
            drag('resize-right'),
            refs(preview({ durationOverride: new Map([['o1', 2]]) }), null, null),
            [],
        ],
        [
            'a left resize that moves the start',
            drag('resize-left'),
            refs(preview({ beatOverride: new Map([['o1', { beat: 1, duration: 3 }]]) }), null, null),
            ['other'],
        ],
        [
            'a left resize back to its own extent',
            drag('resize-left'),
            refs(preview({ beatOverride: new Map([['o1', { beat: 2, duration: 2 }]]) }), null, null),
            [],
        ],
        ['a move of notes from two clips', drag('move'), refs(twoClipMove, null, null), ['primary', 'other']],
        ['a move by pitch only', drag('move'), refs(preview({ pitchDelta: -2 }), null, null), ['other']],
        ['a zero-delta move, which is a selection click', drag('move'), refs(preview(), null, null), []],
        ['a zero-delta alt-duplicate', drag('duplicate'), refs(preview(), null, null), []],
        ['a press on a note that never moved', drag('move'), refs(null, null, null), []],
        [
            'a click-stamp left pending in the target clip',
            drag('rubber-band', null),
            refs(null, { pitch: 60 }, { w: 0, h: 0 }),
            ['other'],
        ],
        ['a rubber-band drag that grew', drag('rubber-band', null), refs(null, { pitch: 60 }, { w: 40, h: 40 }), []],
        ['a rubber-band with no stamp', drag('rubber-band', null), refs(null, null, { w: 0, h: 0 }), []],
        ['paint mode', drag('paint', null), refs(null, null, null), []],
    ])('%s', (_name, releaseDrag, releaseRefs, expected) => {
        expect(releaseClips(releaseDrag, releaseRefs, targetOther)).toEqual(expected);
    });
});
