import { describe, it, expect, beforeEach } from 'vitest';
import { automationStore } from '../automationStore';

describe('automationStore', () => {
    beforeEach(() => {
        automationStore.set({ lanes: [] });
    });

    it('should have initial empty state', () => {
        expect(automationStore.value?.lanes).toHaveLength(0);
    });

    it('should store automation lanes', () => {
        const lane = {
            id: 'l1',
            trackId: 't1',
            parameterId: 'gain',
            parameterName: 'Gain',
            points: [],
            objects: [],
            visible: true,
            enabled: true,
            collapsed: false,
            virginTerritory: true,
            minValue: 0,
            maxValue: 1,
        };
        automationStore.set({ lanes: [lane] });
        
        expect(automationStore.value?.lanes).toHaveLength(1);
        expect(automationStore.value?.lanes[0]).toEqual(lane);
    });
});
