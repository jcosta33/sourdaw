import { describe, it, expect, beforeEach } from 'vitest';

import { sessionLaunchStore } from '../../../stores/sessionLaunchStore';
import { launchSessionScene } from '../launchSessionScene';
import { stopAllSessionSlots } from '../stopAllSessionSlots';
import { toggleSessionSlot } from '../toggleSessionSlot';

describe('sessionLaunch write boundary', () => {
    beforeEach(() => {
        sessionLaunchStore.set({ activeSlots: {} });
    });

    describe('toggleSessionSlot', () => {
        it('launches the slot when the track has no active slot', () => {
            toggleSessionSlot('track-1', 2);
            expect(sessionLaunchStore.value?.activeSlots).toEqual({ 'track-1': 2 });
        });

        it('clears the slot when the same scene is already active', () => {
            toggleSessionSlot('track-1', 2);
            toggleSessionSlot('track-1', 2);
            expect(sessionLaunchStore.value?.activeSlots).toEqual({});
        });

        it('switches to a different scene without clearing', () => {
            toggleSessionSlot('track-1', 2);
            toggleSessionSlot('track-1', 5);
            expect(sessionLaunchStore.value?.activeSlots).toEqual({ 'track-1': 5 });
        });

        it('leaves other tracks untouched', () => {
            toggleSessionSlot('track-1', 2);
            toggleSessionSlot('track-2', 3);
            expect(sessionLaunchStore.value?.activeSlots).toEqual({ 'track-1': 2, 'track-2': 3 });
        });
    });

    describe('launchSessionScene', () => {
        it('sets every given track to the scene index', () => {
            launchSessionScene(['track-1', 'track-2', 'track-3'], 4);
            expect(sessionLaunchStore.value?.activeSlots).toEqual({
                'track-1': 4,
                'track-2': 4,
                'track-3': 4,
            });
        });

        it('replaces any prior active slots', () => {
            toggleSessionSlot('track-9', 1);
            launchSessionScene(['track-1'], 0);
            expect(sessionLaunchStore.value?.activeSlots).toEqual({ 'track-1': 0 });
        });
    });

    describe('stopAllSessionSlots', () => {
        it('clears all active slots', () => {
            launchSessionScene(['track-1', 'track-2'], 4);
            stopAllSessionSlots();
            expect(sessionLaunchStore.value?.activeSlots).toEqual({});
        });
    });
});
