import { describe, it, expect, beforeEach } from 'vitest';

import { controlRoomStore, getNextMonitorId, getNextCueId } from '../controlRoom';
import { controlSurfaceStore, getNextOscEndpointId } from '../controlSurface';
import { linkStatusStore, defaultLinkStatus, getLinkStatusSnapshot } from '../linkStatusStore';

describe('AudioEngine Misc Stores', () => {
    describe('controlRoomStore', () => {
        beforeEach(() => {
            // Can't easily reset initialData because it calls ID generators,
            // but we can test the structure.
        });

        it('should have initial state', () => {
            expect(controlRoomStore.value?.monitors).toHaveLength(2);
            expect(controlRoomStore.value?.activeMonitorId).toBeDefined();
            expect(controlRoomStore.value?.monitorVolume).toBe(-6);
        });

        it('should generate sequential monitor IDs', () => {
            const id1 = getNextMonitorId();
            const id2 = getNextMonitorId();
            expect(id1.startsWith('mon-')).toBe(true);
            expect(id1).not.toBe(id2);
        });

        it('should generate sequential cue IDs', () => {
            const id1 = getNextCueId();
            const id2 = getNextCueId();
            expect(id1.startsWith('cue-')).toBe(true);
            expect(id1).not.toBe(id2);
        });

        it('should update state', () => {
            controlRoomStore.update((state) => ({ ...state!, monitorVolume: -10 }));
            expect(controlRoomStore.value?.monitorVolume).toBe(-10);
        });
    });

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
