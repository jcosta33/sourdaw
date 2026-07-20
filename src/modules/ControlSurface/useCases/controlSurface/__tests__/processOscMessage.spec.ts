import { describe, it, expect, beforeEach } from 'vitest';

import { controlSurfaceStore } from '../../../stores/controlSurface';
import { processOscMessage } from '../processOscMessage';

const initialState = controlSurfaceStore.value;
if (!initialState) {
    throw new Error('controlSurfaceStore did not initialize with data');
}

describe('processOscMessage', () => {
    beforeEach(() => {
        controlSurfaceStore.set({
            ...initialState,
            oscMappings: [
                {
                    oscAddress: '/track/1/gain',
                    actionType: 'trackGain',
                    parameterPath: 'track.0.gain',
                    min: -10,
                    max: 10,
                },
            ],
        });
    });

    it('returns null when there is no control surface state', () => {
        controlSurfaceStore.set(null);

        expect(processOscMessage('/track/1/gain', 0)).toBeNull();
    });

    it('returns null when no mapping matches the address', () => {
        expect(processOscMessage('/track/9/gain', 0)).toBeNull();
    });

    it('normalizes the raw value into the mapped range', () => {
        expect(processOscMessage('/track/1/gain', 0)).toEqual({
            actionType: 'trackGain',
            parameterPath: 'track.0.gain',
            normalizedValue: 0.5,
        });
    });

    it('clamps normalization to [0, 1] outside the mapped range', () => {
        expect(processOscMessage('/track/1/gain', 100)?.normalizedValue).toBe(1);
        expect(processOscMessage('/track/1/gain', -100)?.normalizedValue).toBe(0);
    });
});
