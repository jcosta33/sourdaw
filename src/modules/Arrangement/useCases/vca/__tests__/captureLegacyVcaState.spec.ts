import { describe, expect, it, beforeEach } from 'vitest';

import { type AppAction } from '#/utils/handlerContract';

import { TrackDummy } from '../../../__tests__/TrackDummy';
import { trackStore } from '../../../stores/trackStore';
import { setVcaGroupsState, type VcaGroup } from '../../../stores/vcaGroupStore';
import { captureLegacyVcaState } from '../captureLegacyVcaState';

type RestorePayload = Extract<AppAction, { type: 'restoreLegacyVcaState' }>['payload'];

function group(overrides?: Partial<VcaGroup>): VcaGroup {
    return {
        id: 'vca-1',
        name: 'VCA 1',
        gain: 1,
        muted: false,
        trackIds: [],
        ...overrides,
    };
}

function tracks(...tracks: ReturnType<typeof TrackDummy.create>[]): void {
    trackStore.set({ tracks, selectedTrackId: tracks[0]?.id ?? null });
}

describe('captureLegacyVcaState', () => {
    beforeEach(() => {
        setVcaGroupsState([]);
        trackStore.set({ tracks: [], selectedTrackId: null });
    });

    describe('createVcaGroup', () => {
        it('throws when the command did not fix the group identity', () => {
            const action = {
                type: 'createVcaGroup',
                payload: { name: 'VCA 1', trackIds: ['t1'] },
            } as const satisfies Extract<AppAction, { type: 'createVcaGroup' }>;

            // The contract requires the command layer to assign vcaGroupId before capture.
            expect(() => captureLegacyVcaState(action)).toThrow('fixed group identity');
        });

        it('captures the new group row at the live index with no replacement, filtering unknown track ids', () => {
            setVcaGroupsState([group({ id: 'older', name: 'Older' })]);
            // Tracks already report the new group (post-execute live state), so no track restore is needed.
            tracks(
                TrackDummy.create({ id: 't1', vcaGroupId: 'vca-1' }),
                TrackDummy.create({ id: 't2', vcaGroupId: 'vca-1' })
            );

            const action = {
                type: 'createVcaGroup',
                payload: { name: 'VCA 1', trackIds: ['t1', 'ghost', 't2'], vcaGroupId: 'vca-1' },
            } as const satisfies Extract<AppAction, { type: 'createVcaGroup' }>;

            const payload = captureLegacyVcaState(action);

            expect(payload.groupRows).toEqual([
                {
                    groupId: 'vca-1',
                    expected: {
                        group: {
                            id: 'vca-1',
                            name: 'VCA 1',
                            gain: 1,
                            muted: false,
                            trackIds: ['t1', 't2'],
                        },
                        index: 1,
                    },
                    replacement: null,
                },
            ]);
            expect(payload.groupGains).toEqual([]);
            expect(payload.groupMemberships).toEqual([]);
            expect(payload.trackMemberships).toEqual([]);
        });

        it('records a track membership restore for live tracks not yet assigned to the new group', () => {
            setVcaGroupsState([group({ id: 'vca-1', trackIds: ['t1'] })]);
            // t1 already reports the new group; t2 still points at a different group.
            tracks(
                TrackDummy.create({ id: 't1', vcaGroupId: 'vca-1' }),
                TrackDummy.create({ id: 't2', vcaGroupId: 'vca-other' })
            );

            const action = {
                type: 'createVcaGroup',
                payload: { name: 'VCA 1', trackIds: ['t1', 't2'], vcaGroupId: 'vca-1' },
            } as const satisfies Extract<AppAction, { type: 'createVcaGroup' }>;

            const payload = captureLegacyVcaState(action);

            expect(payload.trackMemberships).toEqual([
                {
                    trackId: 't2',
                    expectedVcaGroupId: 'vca-1',
                    replacementVcaGroupId: 'vca-other',
                },
            ]);
        });

        it('records group membership restore for the new members already seated in other live groups', () => {
            setVcaGroupsState([group({ id: 'vca-1', trackIds: ['t1'] }), group({ id: 'vca-2', trackIds: ['t1'] })]);
            tracks(TrackDummy.create({ id: 't1', vcaGroupId: 'vca-1' }));

            const action = {
                type: 'createVcaGroup',
                payload: { name: 'VCA 1', trackIds: ['t1'], vcaGroupId: 'vca-1' },
            } as const satisfies Extract<AppAction, { type: 'createVcaGroup' }>;

            const payload = captureLegacyVcaState(action);

            // Both live groups contain t1, so both memberships must restore.
            expect(payload.groupMemberships).toContainEqual({
                groupId: 'vca-1',
                trackId: 't1',
                expectedIndices: [],
                replacementIndices: [0],
            });
            expect(payload.groupMemberships).toContainEqual({
                groupId: 'vca-2',
                trackId: 't1',
                expectedIndices: [],
                replacementIndices: [0],
            });
        });

        it('deduplicates repeated track ids in the action payload', () => {
            setVcaGroupsState([group({ id: 'vca-1', trackIds: ['t1', 't1'] })]);
            tracks(TrackDummy.create({ id: 't1' }));

            const action = {
                type: 'createVcaGroup',
                payload: { name: 'VCA 1', trackIds: ['t1', 't1'], vcaGroupId: 'vca-1' },
            } as const satisfies Extract<AppAction, { type: 'createVcaGroup' }>;

            const payload = captureLegacyVcaState(action);

            expect(payload.groupRows[0]?.expected?.group.trackIds).toEqual(['t1']);
        });
    });

    describe('assignToVca', () => {
        it('returns an empty patch when the target group or track is unknown', () => {
            setVcaGroupsState([]);
            tracks(TrackDummy.create({ id: 't1' }));

            const action = {
                type: 'assignToVca',
                payload: { trackId: 't1', vcaGroupId: 'missing' },
            } as const satisfies Extract<AppAction, { type: 'assignToVca' }>;

            expect(captureLegacyVcaState(action)).toEqual({
                groupRows: [],
                groupGains: [],
                groupMemberships: [],
                trackMemberships: [],
            });
        });

        it('captures the membership delta when the track is newly added to the target group', () => {
            setVcaGroupsState([group({ id: 'vca-1', trackIds: ['t1'] })]);
            tracks(TrackDummy.create({ id: 't1', vcaGroupId: 'vca-1' }));

            const action = {
                type: 'assignToVca',
                payload: { trackId: 't1', vcaGroupId: 'vca-1' },
            } as const satisfies Extract<AppAction, { type: 'assignToVca' }>;

            const payload = captureLegacyVcaState(action);

            // Track is already seated at index 0 in the only group; expected (post-assign) count 1,
            // replacement (live) index 0 -> equal, so no group membership patch.
            expect(payload.groupMemberships).toEqual([]);
            expect(payload.trackMemberships).toEqual([]);
        });

        it('captures a group membership patch when the track sits in a different live group', () => {
            setVcaGroupsState([group({ id: 'vca-1', trackIds: [] }), group({ id: 'vca-2', trackIds: ['t1'] })]);
            tracks(TrackDummy.create({ id: 't1', vcaGroupId: 'vca-2' }));

            const action = {
                type: 'assignToVca',
                payload: { trackId: 't1', vcaGroupId: 'vca-1' },
            } as const satisfies Extract<AppAction, { type: 'assignToVca' }>;

            const payload = captureLegacyVcaState(action);

            // After assigning to vca-1, t1 is removed from vca-2 but lives at index 0 there now.
            expect(payload.groupMemberships).toContainEqual({
                groupId: 'vca-2',
                trackId: 't1',
                expectedIndices: [],
                replacementIndices: [0],
            });
            // Track-level membership: expected is the new group, replacement is the old group.
            expect(payload.trackMemberships).toEqual([
                {
                    trackId: 't1',
                    expectedVcaGroupId: 'vca-1',
                    replacementVcaGroupId: 'vca-2',
                },
            ]);
        });

        it('omits the track membership patch when the track already belongs to the target group', () => {
            setVcaGroupsState([group({ id: 'vca-1', trackIds: ['t1'] })]);
            tracks(TrackDummy.create({ id: 't1', vcaGroupId: 'vca-1' }));

            const action = {
                type: 'assignToVca',
                payload: { trackId: 't1', vcaGroupId: 'vca-1' },
            } as const satisfies Extract<AppAction, { type: 'assignToVca' }>;

            const payload = captureLegacyVcaState(action);

            expect(payload.trackMemberships).toEqual([]);
        });
    });

    describe('removeFromVca', () => {
        it('captures the prior seat index for every group containing the track', () => {
            setVcaGroupsState([
                group({ id: 'vca-1', trackIds: ['t1'] }),
                group({ id: 'vca-2', trackIds: ['other', 't1'] }),
            ]);
            tracks(TrackDummy.create({ id: 't1', vcaGroupId: 'vca-2' }));

            const action = {
                type: 'removeFromVca',
                payload: { trackId: 't1' },
            } as const satisfies Extract<AppAction, { type: 'removeFromVca' }>;

            const payload = captureLegacyVcaState(action);

            expect(payload.groupMemberships).toContainEqual({
                groupId: 'vca-1',
                trackId: 't1',
                expectedIndices: [],
                replacementIndices: [0],
            });
            expect(payload.groupMemberships).toContainEqual({
                groupId: 'vca-2',
                trackId: 't1',
                expectedIndices: [],
                replacementIndices: [1],
            });
            expect(payload.trackMemberships).toEqual([
                {
                    trackId: 't1',
                    expectedVcaGroupId: null,
                    replacementVcaGroupId: 'vca-2',
                },
            ]);
        });

        it('emits no track membership patch when the track already has no vca group', () => {
            setVcaGroupsState([group({ id: 'vca-1', trackIds: ['t1'] })]);
            tracks(TrackDummy.create({ id: 't1', vcaGroupId: null }));

            const action = {
                type: 'removeFromVca',
                payload: { trackId: 't1' },
            } as const satisfies Extract<AppAction, { type: 'removeFromVca' }>;

            const payload = captureLegacyVcaState(action);

            expect(payload.trackMemberships).toEqual([]);
        });

        it('captures every prior occurrence index for duplicate legacy memberships', () => {
            setVcaGroupsState([group({ id: 'vca-1', trackIds: ['t1', 'other', 't1', 't1'] })]);
            tracks(TrackDummy.create({ id: 't1', vcaGroupId: 'vca-1' }));

            const action = {
                type: 'removeFromVca',
                payload: { trackId: 't1' },
            } as const satisfies Extract<AppAction, { type: 'removeFromVca' }>;

            const payload = captureLegacyVcaState(action);

            expect(payload.groupMemberships).toEqual([
                {
                    groupId: 'vca-1',
                    trackId: 't1',
                    expectedIndices: [],
                    replacementIndices: [0, 2, 3],
                },
            ]);
        });
    });

    describe('setVcaGain', () => {
        it('captures the prior gain when the live group differs', () => {
            setVcaGroupsState([group({ id: 'vca-1', gain: 0.5 })]);

            const action = {
                type: 'setVcaGain',
                payload: { vcaGroupId: 'vca-1', gain: 1.2 },
            } as const satisfies Extract<AppAction, { type: 'setVcaGain' }>;

            const payload = captureLegacyVcaState(action);

            expect(payload.groupGains).toEqual([{ groupId: 'vca-1', expectedGain: 1.2, replacementGain: 0.5 }]);
        });

        it('returns an empty patch when the gain already matches (clamped)', () => {
            setVcaGroupsState([group({ id: 'vca-1', gain: 1 })]);

            const action = {
                type: 'setVcaGain',
                payload: { vcaGroupId: 'vca-1', gain: 1 },
            } as const satisfies Extract<AppAction, { type: 'setVcaGain' }>;

            const payload = captureLegacyVcaState(action);

            expect(payload.groupGains).toEqual([]);
        });

        it('clamps the expected gain to the 0..2 range before comparison', () => {
            setVcaGroupsState([group({ id: 'vca-1', gain: 2 })]);

            const action = {
                type: 'setVcaGain',
                payload: { vcaGroupId: 'vca-1', gain: 99 },
            } as const satisfies Extract<AppAction, { type: 'setVcaGain' }>;

            const payload = captureLegacyVcaState(action);

            // 99 clamps to 2, which equals live gain -> no patch.
            expect(payload.groupGains).toEqual([]);
        });

        it('returns an empty patch when the target group does not exist', () => {
            setVcaGroupsState([]);

            const action = {
                type: 'setVcaGain',
                payload: { vcaGroupId: 'missing', gain: 1 },
            } as const satisfies Extract<AppAction, { type: 'setVcaGain' }>;

            expect(captureLegacyVcaState(action)).toEqual({
                groupRows: [],
                groupGains: [],
                groupMemberships: [],
                trackMemberships: [],
            });
        });
    });

    describe('restoreLegacyVcaState inversion', () => {
        it('inverts the captured restore payload so it can re-apply the undone change', () => {
            const original: RestorePayload = {
                groupRows: [
                    {
                        groupId: 'vca-1',
                        expected: {
                            group: { id: 'vca-1', name: 'A', gain: 1, muted: false, trackIds: ['t1'] },
                            index: 0,
                        },
                        replacement: null,
                    },
                ],
                groupGains: [{ groupId: 'vca-1', expectedGain: 1, replacementGain: 0.5 }],
                groupMemberships: [
                    { groupId: 'vca-1', trackId: 't1', expectedIndices: [1, 3], replacementIndices: [] },
                ],
                trackMemberships: [{ trackId: 't1', expectedVcaGroupId: 'vca-1', replacementVcaGroupId: null }],
            };

            const action = {
                type: 'restoreLegacyVcaState',
                payload: original,
            } as const satisfies Extract<AppAction, { type: 'restoreLegacyVcaState' }>;

            const inverted = captureLegacyVcaState(action);

            expect(inverted.groupRows[0]).toEqual({
                groupId: 'vca-1',
                expected: null,
                replacement: {
                    group: { id: 'vca-1', name: 'A', gain: 1, muted: false, trackIds: ['t1'] },
                    index: 0,
                },
            });
            expect(inverted.groupGains).toEqual([{ groupId: 'vca-1', expectedGain: 0.5, replacementGain: 1 }]);
            expect(inverted.groupMemberships).toEqual([
                { groupId: 'vca-1', trackId: 't1', expectedIndices: [], replacementIndices: [1, 3] },
            ]);
            expect(inverted.trackMemberships).toEqual([
                { trackId: 't1', expectedVcaGroupId: null, replacementVcaGroupId: 'vca-1' },
            ]);
        });
    });
});
