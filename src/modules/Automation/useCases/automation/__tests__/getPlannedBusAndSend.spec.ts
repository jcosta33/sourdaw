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

    it('keeps the live send through an unlisted action and drops it once the batch removes it', () => {
        const removal: AppAction = { type: 'removeSend', payload: { trackId: 'track', busId: 'bus' } };

        expect(getPlannedSend('track', 'bus', [unlisted])).toMatchObject({ busId: 'bus', level: 0.5 });
        expect(getPlannedSend('track', 'bus', [unlisted, removal])).toBeUndefined();
    });
});
