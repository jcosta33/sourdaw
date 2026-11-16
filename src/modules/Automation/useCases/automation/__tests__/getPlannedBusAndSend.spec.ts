import { beforeEach, describe, expect, it } from 'vitest';

import { trackStore } from '#/modules/Arrangement/stores';
import { createTrack } from '#/modules/Arrangement/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { getPlannedBus } from '../getPlannedBus';
import { getPlannedSend } from '../getPlannedSend';

// An action neither planner lists: it must leave the plan as the live state stands.
const unlisted: AppAction = { type: 'togglePlayback' };

describe('planned bus and send', () => {
    beforeEach(() => {
        trackStore.set({
            tracks: [
                {
                    ...createTrack({ id: 'track', name: 'Track', kind: 'audio' }),
                    sends: [{ busId: 'bus', level: 0.5, preFader: false }],
                },
                createTrack({ id: 'bus', name: 'Bus', kind: 'bus' }),
            ],
            selectedTrackId: null,
        });
    });

    it('keeps the live bus through an unlisted action and drops it once the batch removes it', () => {
        const removal: AppAction = { type: 'removeTrack', payload: { trackId: 'bus' } };

        expect(getPlannedBus('bus', [unlisted])?.name).toBe('Bus');
        expect(getPlannedBus('bus', [unlisted, removal])).toBeUndefined();
    });

    it('drops a live bus once the batch discards it as a created track', () => {
        const discard: AppAction = { type: 'discardCreatedTrack', payload: { trackId: 'bus' } };

        expect(getPlannedBus('bus', [unlisted, discard])).toBeUndefined();
    });

    it('drops a bus an earlier createBus mints once a later removeTrack removes it, and keeps it for another track', () => {
        const create: AppAction = { type: 'createBus', payload: { busId: 'new-bus', name: 'Verb' } };
        const removeOther: AppAction = { type: 'removeTrack', payload: { trackId: 'track' } };
        const removeBus: AppAction = { type: 'removeTrack', payload: { trackId: 'new-bus' } };

        expect(getPlannedBus('new-bus', [create, removeOther])).toMatchObject({ id: 'new-bus', name: 'Verb' });
        expect(getPlannedBus('new-bus', [create, removeBus])).toBeUndefined();
    });

    it('keeps the live bus through a removeDevice, which removes no track', () => {
        const removeDevice: AppAction = { type: 'removeDevice', payload: { deviceId: 'device-1' } };

        expect(getPlannedBus('bus', [removeDevice])?.name).toBe('Bus');
    });

    it('keeps the live send through an unlisted action and drops it once the batch removes it', () => {
        const removal: AppAction = { type: 'removeSend', payload: { trackId: 'track', busId: 'bus' } };

        expect(getPlannedSend('track', 'bus', [unlisted])).toMatchObject({ busId: 'bus', level: 0.5 });
        expect(getPlannedSend('track', 'bus', [unlisted, removal])).toBeUndefined();
    });

    it('drops a planned send once the batch removes its source track', () => {
        const removal: AppAction = { type: 'removeTrack', payload: { trackId: 'track' } };

        expect(getPlannedSend('track', 'bus', [unlisted, removal])).toBeUndefined();
    });

    it('drops a planned send once the batch removes its bus', () => {
        const removal: AppAction = { type: 'removeTrack', payload: { trackId: 'bus' } };

        expect(getPlannedSend('track', 'bus', [unlisted, removal])).toBeUndefined();
    });

    it('keeps a planned send when the batch removes an unrelated track', () => {
        const removal: AppAction = { type: 'removeTrack', payload: { trackId: 'other' } };

        expect(getPlannedSend('track', 'bus', [removal])).toMatchObject({ busId: 'bus', level: 0.5 });
    });

    it('drops a planned send once the batch discards its source track as a created track', () => {
        const discard: AppAction = { type: 'discardCreatedTrack', payload: { trackId: 'track' } };

        expect(getPlannedSend('track', 'bus', [unlisted, discard])).toBeUndefined();
    });

    it('drops a planned send once the batch discards its bus as a created track', () => {
        const discard: AppAction = { type: 'discardCreatedTrack', payload: { trackId: 'bus' } };

        expect(getPlannedSend('track', 'bus', [unlisted, discard])).toBeUndefined();
    });

    it('drops a planned send once a batch discard lists its source track', () => {
        const discard: AppAction = { type: 'discardCreatedTracks', payload: { trackIds: ['other', 'track'] } };

        expect(getPlannedSend('track', 'bus', [unlisted, discard])).toBeUndefined();
    });

    it('drops a planned send once a batch discard lists its bus', () => {
        const discard: AppAction = { type: 'discardCreatedTracks', payload: { trackIds: ['bus', 'other'] } };

        expect(getPlannedSend('track', 'bus', [unlisted, discard])).toBeUndefined();
    });

    it('keeps a planned send when a batch discard lists only unrelated tracks', () => {
        const discard: AppAction = { type: 'discardCreatedTracks', payload: { trackIds: ['other', 'another'] } };

        expect(getPlannedSend('track', 'bus', [discard])).toMatchObject({ busId: 'bus', level: 0.5 });
    });

    it('drops a planned send once the batch removes every track', () => {
        const removeAll: AppAction = { type: 'removeAllTracks' };

        expect(getPlannedSend('track', 'bus', [unlisted, removeAll])).toBeUndefined();
    });
});
