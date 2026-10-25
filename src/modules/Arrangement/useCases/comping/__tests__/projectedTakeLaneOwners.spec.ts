import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type AppAction } from '#/utils/handlerContract';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { createTake, createTakeLane } from '../../../models/TakeLane';
import { type TakeLaneStoreState } from '../../../stores/takeLaneStore';
import { projectedTakeLaneOwners } from '../projectedTakeLaneOwners';
import { retiredTakeLaneOwnersMatchStore } from '../retiredTakeLaneOwnersMatchStore';
import { reKeyedTakeLaneOwnersMatchStore } from '../reKeyedTakeLaneOwnersMatchStore';

const mocks = vi.hoisted(() => ({ state: { value: null as TakeLaneStoreState | null } }));
vi.mock('../../../stores/takeLaneStore', () => ({ takeLaneStore: mocks.state }));

const source = ClipDummy.create({ id: 'source', trackId: 'track', startBeat: 0, endBeat: 4 });
const originalTake = { ...createTake(source.id, 'Source pass', 2, 4), id: 'shared-take' };
const reKeyedTake = { ...originalTake, clipId: 'split-right' };
const peerTake = { ...createTake('peer-clip', 'Peer pass', 8, 12), id: 'peer-take', selected: true };
const emptyMidi = {
    notes: { present: false, value: [] },
    controlChanges: { present: false, value: [] },
    pitchBends: { present: false, value: [] },
};
const undoSplit: Extract<AppAction, { type: 'restoreClipSplitState' }> = {
    type: 'restoreClipSplitState',
    payload: {
        clipId: source.id,
        rightClipId: 'split-right',
        expected: {
            trackId: 'track',
            leftClip: { ...source, endBeat: 2 },
            rightClip: { ...source, id: 'split-right', startBeat: 2 },
            rightClipIndex: 1,
            sourceMidi: emptyMidi,
            rightMidi: emptyMidi,
        },
        replacement: {
            trackId: 'track',
            leftClip: source,
            rightClip: null,
            rightClipIndex: 1,
            sourceMidi: emptyMidi,
            rightMidi: emptyMidi,
        },
        retiredTakeLanes: [],
        reKeyedTakeLanes: [
            {
                laneId: 'source-lane',
                trackId: 'track',
                takesBefore: [originalTake],
                takesAfter: [reKeyedTake],
                regionsBefore: [],
                regionsAfter: [],
            },
        ],
    },
};

describe('projectedTakeLaneOwners split Undo prefix', () => {
    beforeEach(() => {
        mocks.state.value = {
            lanes: [
                { ...createTakeLane('track'), id: 'source-lane', takes: [reKeyedTake] },
                { ...createTakeLane('peer-track'), id: 'peer-lane', takes: [peerTake] },
            ],
        };
    });

    it('retains a sole re-keyed owner on the restored source without publishing or changing peer owners', () => {
        const before = structuredClone(mocks.state.value);
        expect(projectedTakeLaneOwners([undoSplit])).toEqual([
            { id: 'source-lane', trackId: 'track', takes: [originalTake], activeCompRegions: [] },
            { id: 'peer-lane', trackId: 'peer-track', takes: [peerTake], activeCompRegions: [] },
        ]);
        expect(mocks.state.value).toEqual(before);
    });

    it('projects owned comp deltas for a later guard and preserves unrelated live regions', () => {
        const before = { ...originalTake, startBeat: 0, endBeat: 4 };
        const left = { ...before, endBeat: 2 };
        const right = { ...before, id: 'right-take', clipId: 'split-right', startBeat: 2 };
        const beforeRegion = { startBeat: 0, endBeat: 4, takeId: before.id };
        const afterRegions = [
            { startBeat: 0, endBeat: 2, takeId: left.id },
            { startBeat: 2, endBeat: 4, takeId: right.id },
        ];
        const transition = {
            laneId: 'source-lane',
            trackId: 'track',
            takesBefore: [before],
            takesAfter: [left, right],
            regionsBefore: [beforeRegion],
            regionsAfter: afterRegions,
        };
        const peerRegion = { startBeat: 8, endBeat: 12, takeId: peerTake.id };
        mocks.state.value!.lanes[0]!.takes = [left, right];
        mocks.state.value!.lanes[0]!.activeCompRegions = afterRegions;
        mocks.state.value!.lanes[1]!.activeCompRegions = [peerRegion];
        const action = structuredClone(undoSplit);
        action.payload.reKeyedTakeLanes = [transition];
        const live = structuredClone(mocks.state.value);
        expect(reKeyedTakeLaneOwnersMatchStore([transition], 'apply')).toBe(false);
        expect(reKeyedTakeLaneOwnersMatchStore([transition], 'apply', [action])).toBe(true);
        expect(projectedTakeLaneOwners([action]).map((lane) => lane.activeCompRegions)).toEqual([
            [beforeRegion],
            [peerRegion],
        ]);
        expect(mocks.state.value).toEqual(live);
    });

    it('refuses a later captured global take id collision with the owner restored by the prefix', () => {
        const foreignTake = { ...originalTake, clipId: 'foreign-clip' };
        expect(
            retiredTakeLaneOwnersMatchStore(
                [
                    {
                        laneIndex: 0,
                        lane: { ...createTakeLane('foreign-track'), id: 'foreign-lane', takes: [foreignTake] },
                        retiredTakeIds: [foreignTake.id],
                    },
                ],
                [undoSplit]
            )
        ).toBe(false);
    });
});
