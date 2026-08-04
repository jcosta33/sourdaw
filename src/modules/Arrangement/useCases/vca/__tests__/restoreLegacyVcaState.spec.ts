import { describe, expect, it, beforeEach } from 'vitest';

import { type AppAction } from '#/utils/handlerContract';

import { TrackDummy } from '../../../__tests__/TrackDummy';
import { trackStore } from '../../../stores/trackStore';
import { getVcaGroupsState, setVcaGroupsState, type VcaGroup } from '../../../stores/vcaGroupStore';
import { restoreLegacyVcaState } from '../restoreLegacyVcaState';

type RestorePayload = Extract<AppAction, { type: 'restoreLegacyVcaState' }>['payload'];
type Result = 'written' | 'no-write' | 'conflict';

function emptyPatch(): RestorePayload {
    return { groupRows: [], groupGains: [], groupMemberships: [], trackMemberships: [] };
}

function group(overrides?: Partial<VcaGroup>): VcaGroup {
    return { id: 'vca-1', name: 'VCA 1', gain: 1, muted: false, trackIds: [], ...overrides };
}

function tracks(...tracks: ReturnType<typeof TrackDummy.create>[]): void {
    trackStore.set({ tracks, selectedTrackId: tracks[0]?.id ?? null });
}

describe('restoreLegacyVcaState', () => {
    beforeEach(() => {
        setVcaGroupsState([]);
        trackStore.set({ tracks: [], selectedTrackId: null });
    });

    describe('no-write', () => {
        it('returns no-write for an empty patch and leaves stores untouched', () => {
            setVcaGroupsState([group({ id: 'vca-1' })]);
            const before = getVcaGroupsState();

            expect(restoreLegacyVcaState(emptyPatch())).toBe<Result>('no-write');

            expect(getVcaGroupsState()).toBe(before);
        });
    });

    describe('groupRows', () => {
        it('writes a replacement group at the expected index when the live state matches expected', () => {
            // Live state matches expected (group exists at index 0 with the recorded shape).
            setVcaGroupsState([group({ id: 'vca-1', name: 'Current', gain: 1, trackIds: ['t1'] })]);

            const payload: RestorePayload = {
                ...emptyPatch(),
                groupRows: [
                    {
                        groupId: 'vca-1',
                        expected: {
                            group: { id: 'vca-1', name: 'Current', gain: 1, muted: false, trackIds: ['t1'] },
                            index: 0,
                        },
                        replacement: {
                            group: { id: 'vca-1', name: 'Restored', gain: 0.8, muted: true, trackIds: [] },
                            index: 1,
                        },
                    },
                ],
            };

            expect(restoreLegacyVcaState(payload)).toBe<Result>('written');

            const groups = getVcaGroupsState();
            expect(groups).toHaveLength(1);
            expect(groups[0]).toEqual({
                id: 'vca-1',
                name: 'Restored',
                gain: 0.8,
                muted: true,
                trackIds: [],
            });
        });

        it('removes a group when replacement is null and the live group matches expected', () => {
            setVcaGroupsState([group({ id: 'vca-1', name: 'Bye', trackIds: [] })]);

            const payload: RestorePayload = {
                ...emptyPatch(),
                groupRows: [
                    {
                        groupId: 'vca-1',
                        expected: {
                            group: { id: 'vca-1', name: 'Bye', gain: 1, muted: false, trackIds: [] },
                            index: 0,
                        },
                        replacement: null,
                    },
                ],
            };

            expect(restoreLegacyVcaState(payload)).toBe<Result>('written');
            expect(getVcaGroupsState()).toEqual([]);
        });

        it('conflicts when the live group is at a different index than expected', () => {
            setVcaGroupsState([group({ id: 'other' }), group({ id: 'vca-1', name: 'Bye' })]);

            const payload: RestorePayload = {
                ...emptyPatch(),
                groupRows: [
                    {
                        groupId: 'vca-1',
                        expected: {
                            group: { id: 'vca-1', name: 'Bye', gain: 1, muted: false, trackIds: [] },
                            index: 0, // live index is 1 -> conflict
                        },
                        replacement: null,
                    },
                ],
            };

            expect(restoreLegacyVcaState(payload)).toBe<Result>('conflict');
        });

        it('conflicts when expected is null but the group still exists live', () => {
            setVcaGroupsState([group({ id: 'vca-1' })]);

            const payload: RestorePayload = {
                ...emptyPatch(),
                groupRows: [{ groupId: 'vca-1', expected: null, replacement: null }],
            };

            expect(restoreLegacyVcaState(payload)).toBe<Result>('conflict');
        });

        it('passes when expected is null and the group is genuinely absent, then applies replacement', () => {
            setVcaGroupsState([group({ id: 'other' })]);

            const payload: RestorePayload = {
                ...emptyPatch(),
                groupRows: [
                    {
                        groupId: 'vca-1',
                        expected: null,
                        replacement: {
                            group: { id: 'vca-1', name: 'New', gain: 1, muted: false, trackIds: [] },
                            index: 1,
                        },
                    },
                ],
            };

            expect(restoreLegacyVcaState(payload)).toBe<Result>('written');
            expect(getVcaGroupsState().map((g) => g.id)).toEqual(['other', 'vca-1']);
        });

        it('conflicts when the expected group name differs from live', () => {
            setVcaGroupsState([group({ id: 'vca-1', name: 'Wrong Name' })]);

            const payload: RestorePayload = {
                ...emptyPatch(),
                groupRows: [
                    {
                        groupId: 'vca-1',
                        expected: {
                            group: { id: 'vca-1', name: 'Expected', gain: 1, muted: false, trackIds: [] },
                            index: 0,
                        },
                        replacement: null,
                    },
                ],
            };

            expect(restoreLegacyVcaState(payload)).toBe<Result>('conflict');
        });

        it('clamps the replacement insertion index to the array bounds', () => {
            setVcaGroupsState([group({ id: 'other', name: 'Other' })]);

            const payload: RestorePayload = {
                ...emptyPatch(),
                groupRows: [
                    {
                        groupId: 'vca-1',
                        expected: null,
                        replacement: {
                            group: { id: 'vca-1', name: 'New', gain: 1, muted: false, trackIds: [] },
                            index: 99, // far beyond the live length
                        },
                    },
                ],
            };

            expect(restoreLegacyVcaState(payload)).toBe<Result>('written');
            // Inserted at the tail (clamped to length 1).
            expect(getVcaGroupsState().map((g) => g.id)).toEqual(['other', 'vca-1']);
        });
    });

    describe('groupGains', () => {
        it('writes the replacement gain when the live gain matches expected', () => {
            setVcaGroupsState([group({ id: 'vca-1', gain: 1 })]);

            const payload: RestorePayload = {
                ...emptyPatch(),
                groupGains: [{ groupId: 'vca-1', expectedGain: 1, replacementGain: 0.7 }],
            };

            expect(restoreLegacyVcaState(payload)).toBe<Result>('written');
            expect(getVcaGroupsState()[0]?.gain).toBe(0.7);
        });

        it('conflicts when the live gain does not match expected', () => {
            setVcaGroupsState([group({ id: 'vca-1', gain: 0.5 })]);

            const payload: RestorePayload = {
                ...emptyPatch(),
                groupGains: [{ groupId: 'vca-1', expectedGain: 1, replacementGain: 0.7 }],
            };

            expect(restoreLegacyVcaState(payload)).toBe<Result>('conflict');
            expect(getVcaGroupsState()[0]?.gain).toBe(0.5);
        });

        it('conflicts when the target group does not exist', () => {
            setVcaGroupsState([]);

            const payload: RestorePayload = {
                ...emptyPatch(),
                groupGains: [{ groupId: 'vca-1', expectedGain: 1, replacementGain: 0.7 }],
            };

            expect(restoreLegacyVcaState(payload)).toBe<Result>('conflict');
        });
    });

    describe('groupMemberships', () => {
        it('moves a track to the replacement index when the expected seat matches', () => {
            setVcaGroupsState([group({ id: 'vca-1', trackIds: ['t1', 't2'] })]);

            const payload: RestorePayload = {
                ...emptyPatch(),
                groupMemberships: [
                    // t1 currently at index 0; move it to index 1 (after t2).
                    { groupId: 'vca-1', trackId: 't1', expectedIndices: [0], replacementIndices: [1] },
                ],
            };

            expect(restoreLegacyVcaState(payload)).toBe<Result>('written');
            expect(getVcaGroupsState()[0]?.trackIds).toEqual(['t2', 't1']);
        });

        it('removes the track when replacement index is null', () => {
            setVcaGroupsState([group({ id: 'vca-1', trackIds: ['t1', 't2'] })]);

            const payload: RestorePayload = {
                ...emptyPatch(),
                groupMemberships: [{ groupId: 'vca-1', trackId: 't1', expectedIndices: [0], replacementIndices: [] }],
            };

            expect(restoreLegacyVcaState(payload)).toBe<Result>('written');
            expect(getVcaGroupsState()[0]?.trackIds).toEqual(['t2']);
        });

        it('conflicts when the live seat index differs from expected', () => {
            setVcaGroupsState([group({ id: 'vca-1', trackIds: ['t2', 't1'] })]);

            const payload: RestorePayload = {
                ...emptyPatch(),
                groupMemberships: [{ groupId: 'vca-1', trackId: 't1', expectedIndices: [0], replacementIndices: [] }],
            };

            expect(restoreLegacyVcaState(payload)).toBe<Result>('conflict');
        });

        it('conflicts when the group does not exist', () => {
            setVcaGroupsState([]);

            const payload: RestorePayload = {
                ...emptyPatch(),
                groupMemberships: [{ groupId: 'vca-1', trackId: 't1', expectedIndices: [0], replacementIndices: [] }],
            };

            expect(restoreLegacyVcaState(payload)).toBe<Result>('conflict');
        });

        it('restores every duplicate occurrence at its exact prior index', () => {
            setVcaGroupsState([group({ id: 'vca-1', trackIds: ['other'] })]);

            const payload: RestorePayload = {
                ...emptyPatch(),
                groupMemberships: [
                    {
                        groupId: 'vca-1',
                        trackId: 't1',
                        expectedIndices: [],
                        replacementIndices: [0, 2, 3],
                    },
                ],
            };

            expect(restoreLegacyVcaState(payload)).toBe<Result>('written');
            expect(getVcaGroupsState()[0]?.trackIds).toEqual(['t1', 'other', 't1', 't1']);
        });

        it('conflicts when any duplicate occurrence index differs from the exact guard', () => {
            setVcaGroupsState([group({ id: 'vca-1', trackIds: ['t1', 'other', 't1'] })]);
            const before = getVcaGroupsState().map((candidate) => ({
                ...candidate,
                trackIds: [...candidate.trackIds],
            }));

            const payload: RestorePayload = {
                ...emptyPatch(),
                groupMemberships: [
                    {
                        groupId: 'vca-1',
                        trackId: 't1',
                        expectedIndices: [0, 1],
                        replacementIndices: [],
                    },
                ],
            };

            expect(restoreLegacyVcaState(payload)).toBe<Result>('conflict');
            expect(getVcaGroupsState()).toEqual(before);
        });
    });

    describe('trackMemberships', () => {
        it('writes the replacement vca group id onto the track when expected matches', () => {
            tracks(TrackDummy.create({ id: 't1', vcaGroupId: 'vca-old' }));

            const payload: RestorePayload = {
                ...emptyPatch(),
                trackMemberships: [{ trackId: 't1', expectedVcaGroupId: 'vca-old', replacementVcaGroupId: null }],
            };

            expect(restoreLegacyVcaState(payload)).toBe<Result>('written');
            expect(trackStore.value?.tracks[0]?.vcaGroupId).toBeNull();
        });

        it('conflicts when the live track vca group differs from expected', () => {
            tracks(TrackDummy.create({ id: 't1', vcaGroupId: 'vca-other' }));

            const payload: RestorePayload = {
                ...emptyPatch(),
                trackMemberships: [{ trackId: 't1', expectedVcaGroupId: 'vca-old', replacementVcaGroupId: null }],
            };

            expect(restoreLegacyVcaState(payload)).toBe<Result>('conflict');
            expect(trackStore.value?.tracks[0]?.vcaGroupId).toBe('vca-other');
        });

        it('conflicts when the target track does not exist', () => {
            tracks(TrackDummy.create({ id: 'other' }));

            const payload: RestorePayload = {
                ...emptyPatch(),
                trackMemberships: [{ trackId: 't1', expectedVcaGroupId: null, replacementVcaGroupId: 'vca-1' }],
            };

            expect(restoreLegacyVcaState(payload)).toBe<Result>('conflict');
        });
    });

    describe('combined patch types', () => {
        it('applies group rows, gains, and memberships together when all expected states match', () => {
            setVcaGroupsState([group({ id: 'vca-1', name: 'Current', gain: 1, trackIds: ['t1', 't2'] })]);
            tracks(TrackDummy.create({ id: 't1', vcaGroupId: 'vca-1' }));

            const payload: RestorePayload = {
                groupRows: [
                    {
                        groupId: 'vca-1',
                        expected: {
                            group: {
                                id: 'vca-1',
                                name: 'Current',
                                gain: 1,
                                muted: false,
                                trackIds: ['t1', 't2'],
                            },
                            index: 0,
                        },
                        replacement: null,
                    },
                ],
                groupGains: [], // groupRows already removes the group; gains irrelevant
                groupMemberships: [], // group removed
                trackMemberships: [{ trackId: 't1', expectedVcaGroupId: 'vca-1', replacementVcaGroupId: null }],
            };

            expect(restoreLegacyVcaState(payload)).toBe<Result>('written');
            expect(getVcaGroupsState()).toEqual([]);
            expect(trackStore.value?.tracks[0]?.vcaGroupId).toBeNull();
        });
    });
});
