import { describe, it, expect } from 'vitest';

import { controlSurfaceStore, getNextOscEndpointId } from '../controlSurface';

describe('AudioEngine Misc Stores', () => {
    describe('controlSurfaceStore', () => {
        it('should have initial state', () => {
            expect(controlSurfaceStore.value?.protocol).toBeNull();
            expect(controlSurfaceStore.value?.mcu.faders).toHaveLength(9);
            expect(controlSurfaceStore.value?.mcu.mode).toBe('pan');
        });

        it('should generate sequential OSC endpoint IDs', () => {
            const id1 = getNextOscEndpointId();
            const id2 = getNextOscEndpointId();
            expect(id1.startsWith('osc-')).toBe(true);
            expect(id1).not.toBe(id2);
        });

        it('should update state', () => {
            controlSurfaceStore.update((state) => ({ ...state!, protocol: 'mcu' }));
            expect(controlSurfaceStore.value?.protocol).toBe('mcu');
        });
    });
});
