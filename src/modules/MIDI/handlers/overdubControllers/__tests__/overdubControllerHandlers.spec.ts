import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type AppAction } from '#/utils/handlerContract';

import { type MidiStoreStateInput } from '../../../stores/midiStore';

const mocks = vi.hoisted(() => ({
    midi: { value: null as MidiStoreStateInput | null },
    trackState: { value: null as { tracks: { id: string; clips: { id: string }[] }[] } | null },
}));

vi.mock('../../../stores/midiStore', () => ({
    midiStore: {
        get value() {
            return mocks.midi.value;
        },
        set: vi.fn((next: MidiStoreStateInput | null) => {
            mocks.midi.value = next;
        }),
    },
}));

vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: {
        get value() {
            return mocks.trackState.value;
        },
    },
}));

const { handleAppendOverdubControllers } = await import('../handleAppendOverdubControllers');
const { handleRemoveOverdubControllers } = await import('../handleRemoveOverdubControllers');

type AppendAction = Extract<AppAction, { type: 'appendOverdubControllers' }>;
type RemoveAction = Extract<AppAction, { type: 'removeOverdubControllers' }>;

const CLIP = 'clip-a';
const OTHER_CLIP = 'clip-b';
const validationContext = { actions: [], actionIndex: 0 };
const listsExisted = { ccListExisted: true, pitchBendListExisted: true };

const cc = (id: string, beat: number, controller = 1) => ({ id, controller, value: 64, beat, channel: 0 });
const bend = (id: string, beat: number) => ({ id, value: 1000, beat, channel: 0 });

const append = (...clips: AppendAction['payload']['clips'][number][]): AppendAction => ({
    type: 'appendOverdubControllers',
    payload: { clips },
});

type RowIds = RemoveAction['payload']['clips'][number];

/** Ids to remove, from clips whose lists existed before the pass unless a case says otherwise. */
const remove = (
    ...clips: (Pick<RowIds, 'clipId' | 'ccIds' | 'pitchBendIds'> &
        Partial<Pick<RowIds, 'ccListExisted' | 'pitchBendListExisted'>>)[]
): RemoveAction => ({
    type: 'removeOverdubControllers',
    payload: { clips: clips.map((clip) => ({ ccListExisted: true, pitchBendListExisted: true, ...clip })) },
});

describe('overdub controller handlers', () => {
    beforeEach(() => {
        mocks.trackState.value = { tracks: [{ id: 'track-1', clips: [{ id: CLIP }, { id: OTHER_CLIP }] }] };
        mocks.midi.value = {
            notesByClipId: {},
            ccByClipId: { [CLIP]: [cc('earlier-cc', 0)] },
            pitchBendByClipId: { [CLIP]: [bend('earlier-bend', 0)] },
        };
    });

    describe('appendOverdubControllers', () => {
        it('appends the pass rows after the clip rows, ids included, and reports the write', () => {
            const result = handleAppendOverdubControllers.execute(
                append({ clipId: CLIP, cc: [cc('new-cc', 2)], pitchBend: [bend('new-bend', 2)] })
            );

            expect(result).toEqual({ status: 'written' });
            expect(mocks.midi.value?.ccByClipId[CLIP]).toEqual([cc('earlier-cc', 0), cc('new-cc', 2)]);
            expect(mocks.midi.value?.pitchBendByClipId[CLIP]).toEqual([bend('earlier-bend', 0), bend('new-bend', 2)]);
        });

        it('writes every clip of the pass in the one action', () => {
            handleAppendOverdubControllers.execute(
                append(
                    { clipId: CLIP, cc: [cc('a-cc', 2)], pitchBend: [] },
                    { clipId: OTHER_CLIP, cc: [], pitchBend: [bend('b-bend', 3)] }
                )
            );

            expect(mocks.midi.value?.ccByClipId[CLIP]).toHaveLength(2);
            expect(mocks.midi.value?.pitchBendByClipId[OTHER_CLIP]).toEqual([bend('b-bend', 3)]);
        });

        it('writes nothing into a clip that left the timeline', () => {
            mocks.trackState.value = { tracks: [{ id: 'track-1', clips: [{ id: CLIP }] }] };

            const result = handleAppendOverdubControllers.execute(
                append({ clipId: OTHER_CLIP, cc: [cc('gone-cc', 2)], pitchBend: [] })
            );

            expect(result).toEqual({ status: 'no-write' });
            expect(mocks.midi.value?.ccByClipId[OTHER_CLIP]).toBeUndefined();
        });

        it('never doubles a row the clip already holds under the same id', () => {
            const action = append({ clipId: CLIP, cc: [cc('new-cc', 2)], pitchBend: [] });
            handleAppendOverdubControllers.execute(action);

            const replay = handleAppendOverdubControllers.execute(action);

            expect(replay).toEqual({ status: 'no-write' });
            expect(mocks.midi.value?.ccByClipId[CLIP]).toEqual([cc('earlier-cc', 0), cc('new-cc', 2)]);
        });

        it('names exactly the rows it adds as the inverse, and only those not already stored', () => {
            const described = handleAppendOverdubControllers.describe(
                append({
                    clipId: CLIP,
                    cc: [cc('earlier-cc', 0), cc('new-cc', 2, 101)],
                    pitchBend: [bend('new-bend', 2)],
                })
            );

            expect(described.inverseAction).toEqual({
                type: 'removeOverdubControllers',
                payload: {
                    clips: [
                        {
                            clipId: CLIP,
                            ccIds: ['new-cc'],
                            pitchBendIds: ['new-bend'],
                            ccListExisted: true,
                            pitchBendListExisted: true,
                        },
                    ],
                },
            });
        });

        it('records which of the clip lists existed before the pass, so the inverse drops only one the pass created', () => {
            mocks.midi.value = {
                notesByClipId: {},
                ccByClipId: { [CLIP]: [] },
                pitchBendByClipId: {},
            };

            const described = handleAppendOverdubControllers.describe(
                append({ clipId: CLIP, cc: [cc('new-cc', 2)], pitchBend: [bend('new-bend', 2)] })
            );

            expect(described.inverseAction).toEqual({
                type: 'removeOverdubControllers',
                payload: {
                    clips: [
                        {
                            clipId: CLIP,
                            ccIds: ['new-cc'],
                            pitchBendIds: ['new-bend'],
                            ccListExisted: true,
                            pitchBendListExisted: false,
                        },
                    ],
                },
            });
        });

        it('describes no inverse for a pass with nothing to write', () => {
            const described = handleAppendOverdubControllers.describe(
                append({ clipId: OTHER_CLIP, cc: [], pitchBend: [] })
            );

            expect(described.inverseAction).toBeNull();
        });

        it('treats a pass of empty clips as a no-op, so it adds no history entry', () => {
            expect(handleAppendOverdubControllers.isNoop?.(append({ clipId: CLIP, cc: [], pitchBend: [] }))).toBe(true);
            expect(
                handleAppendOverdubControllers.isNoop?.(append({ clipId: CLIP, cc: [cc('x', 1)], pitchBend: [] }))
            ).toBe(false);
        });

        it.each([
            ['a row id that is not a string', { clipId: CLIP, cc: [{ ...cc('x', 1), id: 7 }], pitchBend: [] }],
            ['a non-finite beat', { clipId: CLIP, cc: [{ ...cc('x', 1), beat: Number.NaN }], pitchBend: [] }],
            [
                'a pitch-bend row with a missing channel',
                { clipId: CLIP, cc: [], pitchBend: [{ id: 'x', value: 1, beat: 0 }] },
            ],
            ['a clip id that is not a string', { clipId: 3, cc: [], pitchBend: [] }],
            ['a clip without its controller list', { clipId: CLIP, pitchBend: [] }],
        ])('refuses a pass with %s', (_name, clip) => {
            const action = { type: 'appendOverdubControllers', payload: { clips: [clip] } } as unknown as AppendAction;

            expect(handleAppendOverdubControllers.validate?.(action, validationContext)).toBe(false);
        });

        it('refuses a pass that repeats a row id, because the inverse removes rows by id', () => {
            const repeated = append(
                { clipId: CLIP, cc: [cc('same', 1)], pitchBend: [] },
                { clipId: OTHER_CLIP, cc: [], pitchBend: [bend('same', 1)] }
            );

            expect(handleAppendOverdubControllers.validate?.(repeated, validationContext)).toBe(false);
        });

        it('accepts a well-formed pass', () => {
            const pass = append({ clipId: CLIP, cc: [cc('x', 1)], pitchBend: [bend('y', 1)] });

            expect(handleAppendOverdubControllers.validate?.(pass, validationContext)).toBe(true);
        });
    });

    describe('removeOverdubControllers', () => {
        beforeEach(() => {
            mocks.midi.value = {
                notesByClipId: {},
                ccByClipId: { [CLIP]: [cc('earlier-cc', 0), cc('new-cc', 2), cc('peer-cc', 3)] },
                pitchBendByClipId: { [CLIP]: [bend('earlier-bend', 0), bend('new-bend', 2)] },
            };
        });

        it('removes the named rows and leaves every other row, a peer edit included', () => {
            const result = handleRemoveOverdubControllers.execute(
                remove({ clipId: CLIP, ccIds: ['new-cc'], pitchBendIds: ['new-bend'] })
            );

            expect(result).toEqual({ status: 'written' });
            expect(mocks.midi.value?.ccByClipId[CLIP]).toEqual([cc('earlier-cc', 0), cc('peer-cc', 3)]);
            expect(mocks.midi.value?.pitchBendByClipId[CLIP]).toEqual([bend('earlier-bend', 0)]);
        });

        it('drops a list the pass created once the pass empties it, the state the clip had before', () => {
            mocks.midi.value = {
                notesByClipId: {},
                ccByClipId: { [OTHER_CLIP]: [cc('only', 1)] },
                pitchBendByClipId: { [OTHER_CLIP]: [bend('only-bend', 1)] },
            };

            handleRemoveOverdubControllers.execute(
                remove({
                    clipId: OTHER_CLIP,
                    ccIds: ['only'],
                    pitchBendIds: ['only-bend'],
                    ccListExisted: false,
                    pitchBendListExisted: false,
                })
            );

            expect(mocks.midi.value?.ccByClipId[OTHER_CLIP]).toBeUndefined();
            expect(mocks.midi.value?.pitchBendByClipId[OTHER_CLIP]).toBeUndefined();
        });

        it('leaves an empty list where the list existed empty before the pass', () => {
            mocks.midi.value = {
                notesByClipId: {},
                ccByClipId: { [OTHER_CLIP]: [cc('only', 1)] },
                pitchBendByClipId: { [OTHER_CLIP]: [bend('only-bend', 1)] },
            };

            handleRemoveOverdubControllers.execute(
                remove({
                    clipId: OTHER_CLIP,
                    ccIds: ['only'],
                    pitchBendIds: ['only-bend'],
                    ccListExisted: true,
                    pitchBendListExisted: true,
                })
            );

            expect(mocks.midi.value?.ccByClipId[OTHER_CLIP]).toEqual([]);
            expect(mocks.midi.value?.pitchBendByClipId[OTHER_CLIP]).toEqual([]);
        });

        it('keeps each list by its own history: a list that existed stays while one the pass created goes', () => {
            mocks.midi.value = {
                notesByClipId: {},
                ccByClipId: { [OTHER_CLIP]: [cc('only', 1)] },
                pitchBendByClipId: { [OTHER_CLIP]: [bend('only-bend', 1)] },
            };

            handleRemoveOverdubControllers.execute(
                remove({
                    clipId: OTHER_CLIP,
                    ccIds: ['only'],
                    pitchBendIds: ['only-bend'],
                    ccListExisted: true,
                    pitchBendListExisted: false,
                })
            );

            expect(mocks.midi.value?.ccByClipId[OTHER_CLIP]).toEqual([]);
            expect(mocks.midi.value?.pitchBendByClipId[OTHER_CLIP]).toBeUndefined();
        });

        it('reports no write when none of the named rows is left', () => {
            const result = handleRemoveOverdubControllers.execute(
                remove({ clipId: CLIP, ccIds: ['missing'], pitchBendIds: [] })
            );

            expect(result).toEqual({ status: 'no-write' });
            expect(mocks.midi.value?.ccByClipId[CLIP]).toHaveLength(3);
        });

        it('does not take a row of another clip that happens to share an id', () => {
            mocks.midi.value = {
                notesByClipId: {},
                ccByClipId: { [CLIP]: [cc('shared', 1)], [OTHER_CLIP]: [cc('shared', 1)] },
                pitchBendByClipId: {},
            };

            handleRemoveOverdubControllers.execute(
                remove({ clipId: CLIP, ccIds: ['shared'], pitchBendIds: [], ccListExisted: false })
            );

            expect(mocks.midi.value?.ccByClipId[CLIP]).toBeUndefined();
            expect(mocks.midi.value?.ccByClipId[OTHER_CLIP]).toEqual([cc('shared', 1)]);
        });

        it.each([
            ['a row id that is not a string', { ...listsExisted, clipId: CLIP, ccIds: [4], pitchBendIds: [] }],
            ['a clip without its pitch-bend ids', { ...listsExisted, clipId: CLIP, ccIds: [] }],
            ['a clip id that is not a string', { ...listsExisted, clipId: null, ccIds: [], pitchBendIds: [] }],
            ['no record of whether its lists existed', { clipId: CLIP, ccIds: [], pitchBendIds: [] }],
            [
                'a list-existed flag that is not a boolean',
                { clipId: CLIP, ccIds: [], pitchBendIds: [], ccListExisted: 'yes', pitchBendListExisted: true },
            ],
        ])('refuses ids with %s', (_name, clip) => {
            const action = { type: 'removeOverdubControllers', payload: { clips: [clip] } } as unknown as RemoveAction;

            expect(handleRemoveOverdubControllers.validate?.(action, validationContext)).toBe(false);
        });

        it('is the inverse only, so it adds no history entry of its own', () => {
            expect(handleRemoveOverdubControllers.undoable).toBe(false);
        });
    });
});
