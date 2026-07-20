import { describe, it, expect, beforeEach } from 'vitest';

import { controlSurfaceStore } from '../../../stores/controlSurface';
import { addOscMapping } from '../addOscMapping';

const initialState = controlSurfaceStore.value;

describe('addOscMapping', () => {
    beforeEach(() => {
        controlSurfaceStore.set(initialState);
    });

    it('appends mappings, defaulting the range to 0-1 and honouring an explicit range', () => {
        addOscMapping('/track/1/gain', 'trackGain', 'track.0.gain');
        addOscMapping('/track/1/pan', 'trackPan', 'track.0.pan', -50, 50);

        expect(controlSurfaceStore.value?.oscMappings).toEqual([
            { oscAddress: '/track/1/gain', actionType: 'trackGain', parameterPath: 'track.0.gain', min: 0, max: 1 },
            { oscAddress: '/track/1/pan', actionType: 'trackPan', parameterPath: 'track.0.pan', min: -50, max: 50 },
        ]);
    });

    it('is a no-op when the control surface has no state', () => {
        controlSurfaceStore.set(null);

        addOscMapping('/track/1/gain', 'trackGain', 'track.0.gain');

        expect(controlSurfaceStore.value).toBeNull();
    });
});
