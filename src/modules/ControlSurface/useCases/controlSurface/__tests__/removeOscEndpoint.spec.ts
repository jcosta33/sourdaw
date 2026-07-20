import { describe, it, expect, beforeEach } from 'vitest';

import { controlSurfaceStore } from '../../../stores/controlSurface';
import { removeOscEndpoint } from '../removeOscEndpoint';

const initialState = controlSurfaceStore.value;
if (!initialState) {
    throw new Error('controlSurfaceStore did not initialize with data');
}

describe('removeOscEndpoint', () => {
    beforeEach(() => {
        controlSurfaceStore.set({
            ...initialState,
            oscEndpoints: [
                { id: 'osc-1', host: 'a', sendPort: 1, receivePort: 2, active: true },
                { id: 'osc-2', host: 'b', sendPort: 3, receivePort: 4, active: true },
            ],
        });
    });

    it('removes only the matching endpoint', () => {
        removeOscEndpoint('osc-1');

        expect(controlSurfaceStore.value?.oscEndpoints.map((endpoint) => endpoint.id)).toEqual(['osc-2']);
    });

    it('is a no-op when the control surface has no state', () => {
        controlSurfaceStore.set(null);

        removeOscEndpoint('osc-1');

        expect(controlSurfaceStore.value).toBeNull();
    });
});
