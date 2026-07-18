import { describe, it, expect, beforeEach } from 'vitest';

import { controlSurfaceStore, getNextOscEndpointId } from '../controlSurface';
import { linkStatusStore, defaultLinkStatus, getLinkStatusSnapshot } from '../linkStatusStore';

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

    describe('linkStatusStore', () => {
        beforeEach(() => {
            linkStatusStore.set(defaultLinkStatus);
        });

        it('should have initial state', () => {
            expect(linkStatusStore.value?.enabled).toBe(false);
            expect(linkStatusStore.value?.tempo).toBe(120);
        });

        it('should provide getLinkStatusSnapshot', () => {
            expect(getLinkStatusSnapshot()).toBe(false);
            linkStatusStore.update((state) => ({ ...state!, enabled: true }));
            expect(getLinkStatusSnapshot()).toBe(true);
        });
    });
});
