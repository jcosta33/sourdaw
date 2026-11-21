import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type AppAction } from '#/utils/handlerContract';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { createTake, createTakeLane } from '../../../models/TakeLane';
import { type TakeLaneStoreState } from '../../../stores/takeLaneStore';
import { trackStore } from '../../../stores/trackStore';
import { preparedClipSplits } from '../../clipEditing/preparedClipSplit';
import { projectedTakeLaneOwners } from '../projectedTakeLaneOwners';
import { reKeyedTakeLaneOwnersMatchStore } from '../reKeyedTakeLaneOwnersMatchStore';
import { retiredTakeLaneOwnersMatchStore } from '../retiredTakeLaneOwnersMatchStore';

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

    describe('each prefix action type projects its own owners', () => {
        const reKeyTransition = undoSplit.payload.reKeyedTakeLanes?.[0];
        if (!reKeyTransition) {
            throw new Error('Expected the re-key fixture');
        }
        const liveOriginalLane = () => ({
            ...createTakeLane('track'),
            id: 'source-lane',
            takes: [{ ...originalTake, selected: false }],
        });
        const splitApplied = { id: 'source-lane', trackId: 'track', takes: [reKeyedTake], activeCompRegions: [] };

        it.each([
            ['removeClip', { type: 'removeClip', payload: { clipId: 'split-right' } }],
            ['discardDuplicatedClip', { type: 'discardDuplicatedClip', payload: { clipId: 'split-right' } }],
        ] satisfies [string, AppAction][])('retires the owners of the clip a %s removes', (_type, action) => {
            expect(projectedTakeLaneOwners([action]).map((lane) => lane.id)).toEqual(['peer-lane']);
        });

        it('re-keys the owners of a prepared split', () => {
            const action = {
                type: 'splitClip',
                payload: { clipId: source.id, beat: 2, rightClipId: 'split-right' },
            } satisfies AppAction;
            preparedClipSplits.set(action, {
                adjustedMediaSplit: 2,
                previous: undoSplit.payload.expected,
                next: undoSplit.payload.replacement,
                rightClipId: 'split-right',
                targetNoteIds: [],
                takeReKeyTransitions: [reKeyTransition],
            });

            expect(projectedTakeLaneOwners([action], [liveOriginalLane()])).toEqual([splitApplied]);
        });

        it('leaves owners alone for a split that was never prepared', () => {
            const action = {
                type: 'splitClip',
                payload: { clipId: source.id, beat: 2, rightClipId: 'split-right' },
            } satisfies AppAction;

            expect(projectedTakeLaneOwners([action], [liveOriginalLane()])).toEqual([
                { ...liveOriginalLane(), activeCompRegions: [] },
            ]);
        });

        it('re-keys owners when a split state is restored with its right clip', () => {
            const action = {
                ...undoSplit,
                payload: {
                    ...undoSplit.payload,
                    replacement: {
                        ...undoSplit.payload.replacement,
                        rightClip: { ...source, id: 'split-right', startBeat: 2 },
                    },
                },
            } satisfies AppAction;

            expect(projectedTakeLaneOwners([action], [liveOriginalLane()])).toEqual([splitApplied]);
        });

        it('restores the lane a removed clip retired', () => {
            const retired = { ...createTakeLane('gone-track'), id: 'gone-lane', takes: [peerTake] };
            const action = {
                type: 'restoreClip',
                payload: {
                    clipId: peerTake.clipId,
                    trackId: 'gone-track',
                    clipSnapshot: ClipDummy.create({ id: peerTake.clipId, trackId: 'gone-track' }),
                    ripplePlan: null,
                    midiNotesSnapshot: null,
                    midiCcSnapshot: null,
                    midiPitchBendSnapshot: null,
                    retiredTakeLanes: [{ laneIndex: 0, lane: retired, retiredTakeIds: [peerTake.id] }],
                },
            } satisfies AppAction;

            expect(projectedTakeLaneOwners([action], []).map((lane) => lane.id)).toEqual(['gone-lane']);
        });

        it('leaves owners alone for an action name that is only inherited, read from untrusted JSON', () => {
            const parsed: AppAction = JSON.parse('{"type":"constructor","payload":{"clipId":"split-right"}}');
            const lanes = [liveOriginalLane()];

            expect(projectedTakeLaneOwners([parsed], lanes)).toEqual(lanes);
        });

        it('leaves owners alone for an action outside the clip lifecycle', () => {
            const action = { type: 'renameClip', payload: { clipId: source.id, name: 'Other' } } satisfies AppAction;
            const lanes = [liveOriginalLane()];

            expect(projectedTakeLaneOwners([action], lanes)).toEqual(lanes);
        });
    });

    afterEach(() => {
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
    });

    it('refuses a later captured global take id collision with the owner restored by the prefix', () => {
        // Keep the host valid so this probe fails only on the take identity.
        trackStore.set({
            tracks: [TrackDummy.create({ id: 'foreign-track' })],
            selectedTrackId: null,
            ghostClips: [],
        });
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
