import { describe, it, expect, beforeEach } from 'vitest';

import { controlSurfaceStore } from '../../../stores/controlSurface';
import { addOscEndpoint } from '../addOscEndpoint';

const initialState = controlSurfaceStore.value;

describe('addOscEndpoint', () => {
    beforeEach(() => {
        controlSurfaceStore.set(initialState);
    });

    it('appends a newly generated, active endpoint', () => {
        addOscEndpoint('192.168.1.10', 9000, 9001);

        const endpoints = controlSurfaceStore.value?.oscEndpoints;
        expect(endpoints).toHaveLength(1);
        expect(endpoints?.[0]).toMatchObject({
            host: '192.168.1.10',
            sendPort: 9000,
            receivePort: 9001,
            active: true,
        });
        expect(endpoints?.[0]?.id).toMatch(/^osc-/);
    });

    it('is a no-op when the control surface has no state', () => {
        controlSurfaceStore.set(null);

        addOscEndpoint('192.168.1.10', 9000, 9001);

        expect(controlSurfaceStore.value).toBeNull();
    });
});
