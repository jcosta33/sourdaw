import { describe, it, expect } from 'vitest';

import { controlRoomStore, getNextMonitorId, getNextCueId } from '../controlRoom';

describe('controlRoomStore', () => {
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
