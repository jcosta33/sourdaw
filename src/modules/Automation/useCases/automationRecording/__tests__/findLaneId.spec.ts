import { describe, it, expect, beforeEach } from 'vitest';

import { createAutomationLane } from '../../../models/Automation';
import { automationStore } from '../../../stores/automationStore';
import { findLaneId } from '../findLaneId';

describe('findLaneId', () => {
    beforeEach(() => {
        automationStore.set({ lanes: [] });
    });

    it('should return null when automation store is not initialized', () => {
        automationStore.set(null);
        expect(findLaneId('t1', 'gain')).toBeNull();
    });

    it('should return lane id when track and parameter match', () => {
        const lane = createAutomationLane('t1', 'gain', 'Gain');
        automationStore.set({ lanes: [lane] });
        expect(findLaneId('t1', 'gain')).toBe(lane.id);
    });

    it('should return null when no lane matches the track and parameter', () => {
        automationStore.set({ lanes: [createAutomationLane('t1', 'gain', 'Gain')] });
        expect(findLaneId('t2', 'gain')).toBeNull();
        expect(findLaneId('t1', 'pan')).toBeNull();
    });
});
