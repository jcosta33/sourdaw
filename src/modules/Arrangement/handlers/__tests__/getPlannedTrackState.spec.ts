import { afterEach, describe, expect, it } from 'vitest';

import { type AppAction } from '#/utils/handlerContract';

import { createTrack } from '../../models/Track';
import { defaultTrackState, trackStore } from '../../stores/trackStore';
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
        expect(creating).toEqual(['addTrack', 'createBus']);
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

    it('plans nothing for an id no earlier action creates', () => {
        expect(plan([{ type: 'addTrack', payload: { id: 'other', kind: 'audio' } }], 'new')).toBeNull();
    });

    it('projects a live track through the prior actions', () => {
        trackStore.set({ ...defaultTrackState, tracks: [createTrack({ id: 'live', kind: 'audio', name: 'Live' })] });
        const planned = plan([{ type: 'renameTrack', payload: { trackId: 'live', name: 'Renamed' } }], 'live');
        expect(planned?.name).toBe('Renamed');
    });
});
