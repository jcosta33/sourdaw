import { afterEach, describe, expect, it } from 'vitest';

import { type AppAction } from '#/utils/handlerContract';

import { createTrack } from '../../models/Track';
import { defaultTrackState, trackStore } from '../../stores/trackStore';
import { captureTrackRemovalSnapshot } from '../../useCases/captureTrackRemovalSnapshot';
import { getPlannedTrackState, plannedTrackByActionType } from '../getPlannedTrackState';

function plan(prior: readonly AppAction[], trackId: string) {
    return getPlannedTrackState(
        { actions: [...prior, { type: 'selectTrack', payload: { trackId } }], actionIndex: prior.length },
        trackId
    );
}

describe('getPlannedTrackState', () => {
    afterEach(() => {
        trackStore.set(defaultTrackState);
    });

    it('plans a track for exactly the actions that create one', () => {
        const none = plannedTrackByActionType.selectTrack;
        const creatingEntries = Object.entries(plannedTrackByActionType).filter(([, entry]) => entry !== none);
        const creating = creatingEntries.map(([type]) => type).sort();
        expect(creating).toEqual(['addTrack', 'createBus', 'restoreTrack']);
    });

    it('plans a track an earlier restoreTrack restores from its snapshot, through the actions after it', () => {
        trackStore.set({
            ...defaultTrackState,
            tracks: [{ ...createTrack({ id: 'gone', name: 'Gone', kind: 'audio', gain: 0.5 }), height: 120 }],
        });
        const snapshot = captureTrackRemovalSnapshot('gone');
        trackStore.set(defaultTrackState);
        if (!snapshot) {
            throw new Error('Expected a removal snapshot');
        }

        const planned = plan(
            [
                { type: 'restoreTrack', payload: snapshot },
                { type: 'setTrackHeight', payload: { trackId: 'gone', height: 200 } },
            ],
            'gone'
        );

        expect(planned).toMatchObject({ id: 'gone', name: 'Gone', gain: 0.5, height: 200 });
    });

    it('does not plan a restore for another track', () => {
        trackStore.set({
            ...defaultTrackState,
            tracks: [createTrack({ id: 'gone', name: 'Gone', kind: 'audio', gain: 0.5 })],
        });
        const snapshot = captureTrackRemovalSnapshot('gone');
        trackStore.set(defaultTrackState);
        if (!snapshot) {
            throw new Error('Expected a removal snapshot');
        }

        expect(plan([{ type: 'restoreTrack', payload: snapshot }], 'other')).toBeNull();
    });

    it('plans a track an earlier addTrack creates, under its name and gain', () => {
        const planned = plan([{ type: 'addTrack', payload: { id: 'new', kind: 'audio', name: 'Drums' } }], 'new');
        expect(planned).toMatchObject({ id: 'new', kind: 'audio', name: 'Drums', gain: 0.8 });
    });

    it('never plans a master track from addTrack', () => {
        expect(plan([{ type: 'addTrack', payload: { id: 'new', kind: 'master' } }], 'new')).toBeNull();
    });

    it('plans a bus an earlier createBus creates, at its initial gain', () => {
        const planned = plan([{ type: 'createBus', payload: { busId: 'bus', name: 'Verb', initialGain: 0.5 } }], 'bus');
        expect(planned).toMatchObject({ id: 'bus', kind: 'bus', name: 'Verb', gain: 0.5 });
    });

    it('names a nameless addTrack by the default its position in the batch earns', () => {
        const prior: AppAction[] = [{ type: 'addTrack', payload: { id: 'first', kind: 'audio' } }];
        const first = plan(prior, 'first');
        const second = plan([...prior, { type: 'addTrack', payload: { id: 'second', kind: 'audio' } }], 'second');
        expect(first?.name).toBe('Audio 1');
        expect(second?.name).toBe('Audio 2');
    });

    it('plans an addTrack under the default gain and carries its parent and output', () => {
        const planned = plan(
            [
                {
                    type: 'addTrack',
                    payload: { id: 'new', kind: 'audio', name: 'A', parentId: 'folder', outputId: 'out' },
                },
            ],
            'new'
        );
        expect(planned).toMatchObject({ gain: 0.8, parentId: 'folder', outputId: 'out' });
    });

    it('plans a createBus without an initial gain at the default gain', () => {
        const planned = plan([{ type: 'createBus', payload: { busId: 'bus', name: 'Verb' } }], 'bus');
        expect(planned).toMatchObject({ id: 'bus', kind: 'bus', name: 'Verb', gain: 0.8 });
    });

    it('plans nothing for a bus id no earlier createBus creates', () => {
        expect(plan([{ type: 'createBus', payload: { busId: 'other', name: 'Verb' } }], 'bus')).toBeNull();
    });

    it('plans nothing for an id no earlier action creates', () => {
        expect(plan([{ type: 'addTrack', payload: { id: 'other', kind: 'audio' } }], 'new')).toBeNull();
    });

    it('projects a live track through the prior actions', () => {
        trackStore.set({ ...defaultTrackState, tracks: [createTrack({ id: 'live', kind: 'audio', name: 'Live' })] });
        const planned = plan([{ type: 'renameTrack', payload: { trackId: 'live', name: 'Renamed' } }], 'live');
        expect(planned?.name).toBe('Renamed');
    });
});
