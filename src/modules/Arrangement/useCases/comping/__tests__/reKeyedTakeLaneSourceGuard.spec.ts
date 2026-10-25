import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type TakeReKeyLaneTransitionSnapshot } from '#/utils/handlerContract';

import { type TakeLaneStoreState } from '../../../stores/takeLaneStore';
import { reconcileTransitionBaseGaps } from '../reconcileTakeReKeySources';
import { reKeyedTakeLaneOwnersMatchStore } from '../reKeyedTakeLaneOwnersMatchStore';

const mocks = vi.hoisted(() => ({ state: { value: null as TakeLaneStoreState | null } }));
vi.mock('../../../stores/takeLaneStore', () => ({ takeLaneStore: mocks.state }));

const source = {
    startBeat: 0,
    audioOffsetSeconds: 0,
    audioLoopStartSeconds: 0,
    audioLoopPassEntrySeconds: 0,
    audioLoopPassOriginBeat: 0,
    loopOriginBeat: 0,
    loopLength: 4,
};
const take = { id: 'take', clipId: 'source', name: 'Take', startBeat: 0, endBeat: 4, selected: false };
const right = { ...take, id: 'right-take', clipId: 'right', startBeat: 2 };
const leftRegion = { startBeat: 0, endBeat: 2, takeId: take.id, audioSource: source };
const rightRegion = { startBeat: 2, endBeat: 4, takeId: right.id, audioSource: source };
const transition: TakeReKeyLaneTransitionSnapshot = {
    laneId: 'lane',
    trackId: 'track',
    takesBefore: [take],
    takesAfter: [{ ...take, endBeat: 2 }, right],
    regionsBefore: [{ ...leftRegion, endBeat: 4 }],
    regionsAfter: [leftRegion, rightRegion],
};

describe('take re-key source-value ownership', () => {
    it('keeps an unrelated tile deletion outside the source facets changed by a re-key', () => {
        const own = { clipId: 'source', startBeat: 0, endBeat: 4, audioSource: source };
        const foreign = { clipId: 'foreign', startBeat: 8, endBeat: 12, audioSource: source };
        const leftTile = { ...own, endBeat: 2 };
        const rightTile = { ...own, clipId: 'right', startBeat: 2 };
        const capture = {
            ...transition,
            baseGapAudioSourcesBefore: [foreign, own],
            baseGapAudioSourcesAfter: [foreign, leftTile, rightTile],
        };
        const live = {
            id: 'lane',
            trackId: 'track',
            takes: [...transition.takesAfter],
            activeCompRegions: [],
            baseGapAudioSources: [leftTile, rightTile],
        };
        expect(reconcileTransitionBaseGaps(live, capture, 'restore')).toEqual({ present: true, value: [own] });
    });

    beforeEach(() => {
        mocks.state.value = {
            lanes: [
                {
                    id: 'lane',
                    trackId: 'track',
                    takes: [...transition.takesAfter],
                    activeCompRegions: [...transition.regionsAfter],
                },
            ],
        };
    });

    it('refuses Undo after a peer edits the right region source without changing its geometry', () => {
        const state = mocks.state.value!;
        state.lanes[0]!.activeCompRegions[1] = { ...rightRegion, audioSource: { ...source, audioOffsetSeconds: 9 } };
        const before = structuredClone(state);
        expect(reKeyedTakeLaneOwnersMatchStore([transition], 'restore')).toBe(false);
        expect(mocks.state.value).toEqual(before);
    });
});
